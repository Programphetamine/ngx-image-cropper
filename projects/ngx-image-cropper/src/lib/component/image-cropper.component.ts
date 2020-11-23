import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  isDevMode,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { DomSanitizer, SafeStyle, SafeUrl } from '@angular/platform-browser';
import { CropperPosition, Dimensions, ImageCroppedEvent, ImageTransform, MoveStart } from '../interfaces';
import { ExifTransform } from '../interfaces/exif-transform.interface';
import { MoveTypes } from '../interfaces/move-start.interface';
import { HammerStatic } from '../utils/hammer.utils';
import { CropperService } from '../services/cropper.service';
import { CropperSettings } from '../interfaces/cropper.settings';
import { LoadedImage, LoadImageService } from '../services/load-image.service';
import { resizeCanvas } from '../utils/resize.utils';
import { OutputFormat } from '../interfaces/cropper-options.interface';

@Component({
  selector: 'image-cropper',
  templateUrl: './image-cropper.component.html',
  styleUrls: ['./image-cropper.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CropperService]
})
export class ImageCropperComponent implements OnChanges, OnInit {
  private Hammer: HammerStatic = typeof window !== 'undefined'
    ? (window as any).Hammer as HammerStatic
    : null;
  private settings = new CropperSettings();
  private moveStart: MoveStart;
  private setImageMaxSizeRetries = 0;
  private cropperScaledMinWidth = 20;
  private cropperScaledMinHeight = 20;
  private cropperScaledMaxWidth = 20;
  private cropperScaledMaxHeight = 20;
  private exifTransform: ExifTransform = {rotate: 0, flip: false};
  private stepSize = 3;
  private loadedImage: LoadedImage;

  safeImgDataUrl: SafeUrl | string;
  safeTransformStyle: SafeStyle | string;
  marginLeft: SafeStyle | string = '0px';
  maxSize: Dimensions;
  moveTypes = MoveTypes;
  imageVisible = false;

  @ViewChild('wrapper', {static: true}) wrapper: ElementRef;
  @ViewChild('sourceImage', {static: false}) sourceImage: ElementRef;

  @Input() imageChangedEvent: any;
  @Input() imageURL: string;
  @Input() imageBase64: string;
  @Input() imageFile: File;

  @Input() format: OutputFormat = 'png';
  @Input() transform: ImageTransform = {};
  @Input() maintainAspectRatio = true;
  @Input() aspectRatio = 1;
  @Input() resizeToWidth = 0;
  @Input() resizeToHeight = 0;
  @Input() cropperMinWidth = 0;
  @Input() cropperMinHeight = 0;
  @Input() cropperMaxHeight = 0;
  @Input() cropperMaxWidth = 0;
  @Input() cropperStaticWidth = 0;
  @Input() cropperStaticHeight = 0;
  @Input() canvasRotation = 0;
  @Input() initialStepSize = 3;
  @Input() roundCropper = false;
  @Input() onlyScaleDown = false;
  @Input() imageQuality = 92;
  @Input() autoCrop = true;
  @Input() backgroundColor: string;
  @Input() containWithinAspectRatio = false;
  @Input() hideResizeSquares = false;
  @Input() cropper: CropperPosition = {
    x1: -100,
    y1: -100,
    x2: 10000,
    y2: 10000
  };
  @HostBinding('style.text-align')
  @Input() alignImage: 'left' | 'center' = 'center';
  @HostBinding('class.disabled')
  @Input() disabled = false;

  @Output() imageCropped = new EventEmitter<ImageCroppedEvent>();
  @Output() startCropImage = new EventEmitter<void>();
  @Output() imageLoaded = new EventEmitter<LoadedImage>();
  @Output() cropperReady = new EventEmitter<Dimensions>();
  @Output() loadImageFailed = new EventEmitter<void>();

  constructor(
    private cropperService: CropperService,
    private loadImageService: LoadImageService,
    private sanitizer: DomSanitizer,
    private cd: ChangeDetectorRef
  ) {
    this.initCropper();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (this.cropperStaticHeight && this.cropperStaticWidth) {
      this.hideResizeSquares = true;
      this.cropperMinWidth = this.cropperStaticWidth;
      this.cropperMinHeight = this.cropperStaticHeight;
      this.cropperMaxHeight = this.cropperStaticHeight;
      this.cropperMaxWidth = this.cropperStaticWidth;
      this.maintainAspectRatio = false;
    }

    this.onChangesInputImage(changes);

    // TODO
    /*if (this.originalImage && this.originalImage.complete && this.exifTransform
      && (changes.containWithinAspectRatio || changes.canvasRotation)) {
      this.transformOriginalImage();
    }*/
    if (changes.cropper) {
      this.setMaxSize();
      this.setCropperScaledMinSize();
      this.setCropperScaledMaxSize();
      this.checkCropperPosition(false);
      this.doAutoCrop();
      this.cd.markForCheck();
    }
    if (changes.aspectRatio && this.imageVisible) {
      this.resetCropperPosition();
    }
    if (changes.transform) {
      this.transform = this.transform || {};
      this.setCssTransform();
      this.doAutoCrop();
    }
  }

  private onChangesInputImage(changes: SimpleChanges): void {
    if (changes.imageChangedEvent || changes.imageURL || changes.imageBase64 || changes.imageFile) {
      this.initCropper();
    }
    if (changes.imageChangedEvent && this.isValidImageChangedEvent()) {
      this.loadImageFile(this.imageChangedEvent.target.files[0]);
    }
    if (changes.imageURL && this.imageURL) {
      this.loadImageFromURL(this.imageURL);
    }
    if (changes.imageBase64 && this.imageBase64) {
      this.loadBase64Image(this.imageBase64);
    }
    if (changes.imageFile && this.imageFile) {
      this.loadImageFile(this.imageFile);
    }
  }

  private isValidImageChangedEvent(): boolean {
    return this.imageChangedEvent
      && this.imageChangedEvent.target
      && this.imageChangedEvent.target.files
      && this.imageChangedEvent.target.files.length > 0;
  }

  private setCssTransform() {
    this.safeTransformStyle = this.sanitizer.bypassSecurityTrustStyle(
      'scaleX(' + (this.transform.scale || 1) * (this.transform.flipH ? -1 : 1) + ')' +
      'scaleY(' + (this.transform.scale || 1) * (this.transform.flipV ? -1 : 1) + ')' +
      'rotate(' + (this.transform.rotate || 0) + 'deg)'
    );
  }

  ngOnInit(): void {
    this.stepSize = this.initialStepSize;
    this.activatePinchGesture();
  }

  private initCropper(): void {
    this.imageVisible = false;
    this.loadedImage = null;
    this.safeImgDataUrl = 'data:image/png;base64,iVBORw0KGg'
      + 'oAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQYV2NgAAIAAAU'
      + 'AAarVyFEAAAAASUVORK5CYII=';
    this.moveStart = {
      active: false,
      type: null,
      position: null,
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      clientX: 0,
      clientY: 0
    };
    this.maxSize = {
      width: 0,
      height: 0,
    };
    this.cropper.x1 = -100;
    this.cropper.y1 = -100;
    this.cropper.x2 = 10000;
    this.cropper.y2 = 10000;
    this.cropperService.updateSettings(this.settings);
  }

  private loadImageFile(file: File): void {
    this.loadImageService
      .loadImageFile(file, this.settings)
      .then((res) => this.setLoadedImage(res))
      .catch((err) => this.loadImageError(err));
  }

  private loadBase64Image(imageBase64: string): void {
    this.loadImageService
      .loadBase64Image(imageBase64, this.settings)
      .then((res) => this.setLoadedImage(res))
      .catch((err) => this.loadImageError(err));
  }

  private loadImageFromURL(url: string): void {
    this.loadImageService
      .loadImageFromURL(url, this.settings)
      .then((res) => this.setLoadedImage(res))
      .catch((err) => this.loadImageError(err));
  }

  private setLoadedImage(loadedImage: LoadedImage): void {
    this.loadedImage = loadedImage;
    this.safeImgDataUrl = this.sanitizer.bypassSecurityTrustResourceUrl(loadedImage.transformed.base64);
    this.cd.markForCheck();
  }

  private loadImageError(error: any): void {
    console.error(error);
    this.loadImageFailed.emit();
  }

  imageLoadedInView(): void {
    if (this.loadedImage != null && this.loadedImage.transformed.image != null) {
      this.imageLoaded.emit(this.loadedImage);
      this.setImageMaxSizeRetries = 0;
      setTimeout(() => this.checkImageMaxSizeRecursively());
    }
  }

  private checkImageMaxSizeRecursively(): void {
    if (this.setImageMaxSizeRetries > 40) {
      this.loadImageFailed.emit();
    } else if (this.sourceImageLoaded()) {
      this.setMaxSize();
      this.setCropperScaledMinSize();
      this.setCropperScaledMaxSize();
      this.resetCropperPosition();
      this.cropperReady.emit({...this.maxSize});
      this.cd.markForCheck();
    } else {
      this.setImageMaxSizeRetries++;
      setTimeout(() => this.checkImageMaxSizeRecursively(), 50);
    }
  }

  private sourceImageLoaded(): boolean {
    return this.sourceImage && this.sourceImage.nativeElement && this.sourceImage.nativeElement.offsetWidth > 0;
  }

  @HostListener('window:resize')
  onResize(): void {
    this.resizeCropperPosition();
    this.setMaxSize();
    this.setCropperScaledMinSize();
    this.setCropperScaledMaxSize();
  }

  private activatePinchGesture() {
    if (this.Hammer) {
      const hammer = new this.Hammer(this.wrapper.nativeElement);
      hammer.get('pinch').set({enable: true});
      hammer.on('pinchmove', this.onPinch.bind(this));
      hammer.on('pinchend', this.pinchStop.bind(this));
      hammer.on('pinchstart', this.startPinch.bind(this));
    } else if (isDevMode()) {
      console.warn('[NgxImageCropper] Could not find HammerJS - Pinch Gesture won\'t work');
    }
  }

  private resizeCropperPosition(): void {
    const sourceImageElement = this.sourceImage.nativeElement;
    if (this.maxSize.width !== sourceImageElement.offsetWidth || this.maxSize.height !== sourceImageElement.offsetHeight) {
      this.cropper.x1 = this.cropper.x1 * sourceImageElement.offsetWidth / this.maxSize.width;
      this.cropper.x2 = this.cropper.x2 * sourceImageElement.offsetWidth / this.maxSize.width;
      this.cropper.y1 = this.cropper.y1 * sourceImageElement.offsetHeight / this.maxSize.height;
      this.cropper.y2 = this.cropper.y2 * sourceImageElement.offsetHeight / this.maxSize.height;
    }
  }

  resetCropperPosition(): void {
    const sourceImageElement = this.sourceImage.nativeElement;
    if (this.cropperStaticHeight && this.cropperStaticWidth) {
      this.cropper.x1 = 0;
      this.cropper.x2 = sourceImageElement.offsetWidth > this.cropperStaticWidth ?
        this.cropperStaticWidth : sourceImageElement.offsetWidth;
      this.cropper.y1 = 0;
      this.cropper.y2 = sourceImageElement.offsetHeight > this.cropperStaticHeight ?
        this.cropperStaticHeight : sourceImageElement.offsetHeight;
    } else {
      const cropperWidth = Math.min(this.cropperScaledMaxWidth, sourceImageElement.offsetWidth);
      const cropperHeight = Math.min(this.cropperScaledMaxHeight, sourceImageElement.offsetHeight);
      if (!this.maintainAspectRatio) {
        this.cropper.x1 = 0;
        this.cropper.x2 = cropperWidth;
        this.cropper.y1 = 0;
        this.cropper.y2 = cropperHeight;
      } else if (cropperWidth / this.aspectRatio < cropperHeight) {
        this.cropper.x1 = 0;
        this.cropper.x2 = cropperWidth;
        const cropperHeightWithAspectRatio = cropperWidth / this.aspectRatio;
        this.cropper.y1 = (sourceImageElement.offsetHeight - cropperHeightWithAspectRatio) / 2;
        this.cropper.y2 = this.cropper.y1 + cropperHeightWithAspectRatio;
      } else {
        this.cropper.y1 = 0;
        this.cropper.y2 = cropperHeight;
        const cropperWidthWithAspectRatio = cropperHeight * this.aspectRatio;
        this.cropper.x1 = (sourceImageElement.offsetWidth - cropperWidthWithAspectRatio) / 2;
        this.cropper.x2 = this.cropper.x1 + cropperWidthWithAspectRatio;
      }
    }
    this.doAutoCrop();
    this.imageVisible = true;
  }

  keyboardAccess(event: any) {
    this.changeKeyboardStepSize(event);
    this.keyboardMoveCropper(event);
  }

  private changeKeyboardStepSize(event: any): void {
    if (event.key >= '1' && event.key <= '9') {
      this.stepSize = +event.key;
      return;
    }
  }

  private keyboardMoveCropper(event) {
    const keyboardWhiteList: string[] = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'];
    if (!(keyboardWhiteList.includes(event.key))) {
      return;
    }
    const moveType = event.shiftKey ? MoveTypes.Resize : MoveTypes.Move;
    const position = event.altKey ? this.getInvertedPositionForKey(event.key) : this.getPositionForKey(event.key);
    const moveEvent = this.getEventForKey(event.key, this.stepSize);
    event.preventDefault();
    event.stopPropagation();
    this.startMove({clientX: 0, clientY: 0}, moveType, position);
    this.moveImg(moveEvent);
    this.moveStop();
  }

  private getPositionForKey(key: string): string {
    switch (key) {
      case 'ArrowUp':
        return 'top';
      case 'ArrowRight':
        return 'right';
      case 'ArrowDown':
        return 'bottom';
      case 'ArrowLeft':
      default:
        return 'left';
    }
  }

  private getInvertedPositionForKey(key: string): string {
    switch (key) {
      case 'ArrowUp':
        return 'bottom';
      case 'ArrowRight':
        return 'left';
      case 'ArrowDown':
        return 'top';
      case 'ArrowLeft':
      default:
        return 'right';
    }
  }

  private getEventForKey(key: string, stepSize: number): any {
    switch (key) {
      case 'ArrowUp':
        return {clientX: 0, clientY: stepSize * -1};
      case 'ArrowRight':
        return {clientX: stepSize, clientY: 0};
      case 'ArrowDown':
        return {clientX: 0, clientY: stepSize};
      case 'ArrowLeft':
      default:
        return {clientX: stepSize * -1, clientY: 0};
    }
  }

  startMove(event: any, moveType: MoveTypes, position: string | null = null): void {
    if (this.moveStart && this.moveStart.active && this.moveStart.type === MoveTypes.Pinch) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    this.moveStart = {
      active: true,
      type: moveType,
      position,
      clientX: this.getClientX(event),
      clientY: this.getClientY(event),
      ...this.cropper
    };
  }

  startPinch(event: any) {
    if (!this.safeImgDataUrl) {
      return;
    }
    if (event.preventDefault) {
      event.preventDefault();
    }
    this.moveStart = {
      active: true,
      type: MoveTypes.Pinch,
      position: 'center',
      clientX: this.cropper.x1 + (this.cropper.x2 - this.cropper.x1) / 2,
      clientY: this.cropper.y1 + (this.cropper.y2 - this.cropper.y1) / 2,
      ...this.cropper
    };
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  moveImg(event: any): void {
    if (this.moveStart.active) {
      if (event.stopPropagation) {
        event.stopPropagation();
      }
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (this.moveStart.type === MoveTypes.Move) {
        this.move(event);
        this.checkCropperPosition(true);
      } else if (this.moveStart.type === MoveTypes.Resize) {
        if (!this.cropperStaticWidth && !this.cropperStaticHeight) {
          this.resize(event);
        }
        this.checkCropperPosition(false);
      }
      this.cd.detectChanges();
    }
  }

  onPinch(event: any) {
    if (this.moveStart.active) {
      if (event.stopPropagation) {
        event.stopPropagation();
      }
      if (event.preventDefault) {
        event.preventDefault();
      }
      if (this.moveStart.type === MoveTypes.Pinch) {
        this.resize(event);
        this.checkCropperPosition(false);
      }
      this.cd.detectChanges();
    }
  }

  private setMaxSize(): void {
    if (this.sourceImage) {
      const sourceImageElement = this.sourceImage.nativeElement;
      this.maxSize.width = sourceImageElement.offsetWidth;
      this.maxSize.height = sourceImageElement.offsetHeight;
      this.marginLeft = this.sanitizer.bypassSecurityTrustStyle('calc(50% - ' + this.maxSize.width / 2 + 'px)');
    }
  }

  private setCropperScaledMinSize(): void {
    if (this.loadedImage.transformed.image) {
      this.setCropperScaledMinWidth();
      this.setCropperScaledMinHeight();
    } else {
      this.cropperScaledMinWidth = 20;
      this.cropperScaledMinHeight = 20;
    }
  }

  private setCropperScaledMinWidth(): void {
    this.cropperScaledMinWidth = this.cropperMinWidth > 0
      ? Math.max(20, this.cropperMinWidth / this.loadedImage.transformed.image.width * this.maxSize.width)
      : 20;
  }

  private setCropperScaledMinHeight(): void {
    if (this.maintainAspectRatio) {
      this.cropperScaledMinHeight = Math.max(20, this.cropperScaledMinWidth / this.aspectRatio);
    } else if (this.cropperMinHeight > 0) {
      this.cropperScaledMinHeight = Math.max(20, this.cropperMinHeight / this.loadedImage.transformed.image.height * this.maxSize.height);
    } else {
      this.cropperScaledMinHeight = 20;
    }
  }

  private setCropperScaledMaxSize(): void {
    if (this.loadedImage.transformed.image) {
      const ratio = this.loadedImage.transformed.size.width / this.maxSize.width;
      this.cropperScaledMaxWidth = this.cropperMaxWidth > 20 ? this.cropperMaxWidth / ratio : this.maxSize.width;
      this.cropperScaledMaxHeight = this.cropperMaxHeight > 20 ? this.cropperMaxHeight / ratio : this.maxSize.height;
      if (this.maintainAspectRatio) {
        if (this.cropperScaledMaxWidth > this.cropperScaledMaxHeight * this.aspectRatio) {
          this.cropperScaledMaxWidth = this.cropperScaledMaxHeight * this.aspectRatio;
        } else if (this.cropperScaledMaxWidth < this.cropperScaledMaxHeight * this.aspectRatio) {
          this.cropperScaledMaxHeight = this.cropperScaledMaxWidth / this.aspectRatio;
        }
      }
    } else {
      this.cropperScaledMaxWidth = this.maxSize.width;
      this.cropperScaledMaxHeight = this.maxSize.height;
    }
  }

  private checkCropperPosition(maintainSize = false): void {
    if (this.cropper.x1 < 0) {
      this.cropper.x2 -= maintainSize ? this.cropper.x1 : 0;
      this.cropper.x1 = 0;
    }
    if (this.cropper.y1 < 0) {
      this.cropper.y2 -= maintainSize ? this.cropper.y1 : 0;
      this.cropper.y1 = 0;
    }
    if (this.cropper.x2 > this.maxSize.width) {
      this.cropper.x1 -= maintainSize ? (this.cropper.x2 - this.maxSize.width) : 0;
      this.cropper.x2 = this.maxSize.width;
    }
    if (this.cropper.y2 > this.maxSize.height) {
      this.cropper.y1 -= maintainSize ? (this.cropper.y2 - this.maxSize.height) : 0;
      this.cropper.y2 = this.maxSize.height;
    }
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  moveStop(): void {
    if (this.moveStart.active) {
      this.moveStart.active = false;
      this.doAutoCrop();
    }
  }

  pinchStop(): void {
    if (this.moveStart.active) {
      this.moveStart.active = false;
      this.doAutoCrop();
    }
  }

  private move(event: any) {
    const diffX = this.getClientX(event) - this.moveStart.clientX;
    const diffY = this.getClientY(event) - this.moveStart.clientY;

    this.cropper.x1 = this.moveStart.x1 + diffX;
    this.cropper.y1 = this.moveStart.y1 + diffY;
    this.cropper.x2 = this.moveStart.x2 + diffX;
    this.cropper.y2 = this.moveStart.y2 + diffY;
  }

  private resize(event: any): void {
    const diffX = this.getClientX(event) - this.moveStart.clientX;
    const diffY = this.getClientY(event) - this.moveStart.clientY;
    switch (this.moveStart.position) {
      case 'left':
        this.cropper.x1 = Math.min(Math.max(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMaxWidth),
          this.cropper.x2 - this.cropperScaledMinWidth);
        break;
      case 'topleft':
        this.cropper.x1 = Math.min(Math.max(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMaxWidth),
          this.cropper.x2 - this.cropperScaledMinWidth);
        this.cropper.y1 = Math.min(Math.max(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMaxHeight),
          this.cropper.y2 - this.cropperScaledMinHeight);
        break;
      case 'top':
        this.cropper.y1 = Math.min(Math.max(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMaxHeight),
          this.cropper.y2 - this.cropperScaledMinHeight);
        break;
      case 'topright':
        this.cropper.x2 = Math.max(Math.min(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMaxWidth),
          this.cropper.x1 + this.cropperScaledMinWidth);
        this.cropper.y1 = Math.min(Math.max(this.moveStart.y1 + diffY, this.cropper.y2 - this.cropperScaledMaxHeight),
          this.cropper.y2 - this.cropperScaledMinHeight);
        break;
      case 'right':
        this.cropper.x2 = Math.max(Math.min(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMaxWidth),
          this.cropper.x1 + this.cropperScaledMinWidth);
        break;
      case 'bottomright':
        this.cropper.x2 = Math.max(Math.min(this.moveStart.x2 + diffX, this.cropper.x1 + this.cropperScaledMaxWidth),
          this.cropper.x1 + this.cropperScaledMinWidth);
        this.cropper.y2 = Math.max(Math.min(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMaxHeight),
          this.cropper.y1 + this.cropperScaledMinHeight);
        break;
      case 'bottom':
        this.cropper.y2 = Math.max(Math.min(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMaxHeight),
          this.cropper.y1 + this.cropperScaledMinHeight);
        break;
      case 'bottomleft':
        this.cropper.x1 = Math.min(Math.max(this.moveStart.x1 + diffX, this.cropper.x2 - this.cropperScaledMaxWidth),
          this.cropper.x2 - this.cropperScaledMinWidth);
        this.cropper.y2 = Math.max(Math.min(this.moveStart.y2 + diffY, this.cropper.y1 + this.cropperScaledMaxHeight),
          this.cropper.y1 + this.cropperScaledMinHeight);
        break;
      case 'center':
        const scale = event.scale;
        const newWidth = (Math.abs(this.moveStart.x2 - this.moveStart.x1)) * scale;
        const newHeight = (Math.abs(this.moveStart.y2 - this.moveStart.y1)) * scale;
        const x1 = this.cropper.x1;
        const y1 = this.cropper.y1;
        this.cropper.x1 = Math.min(
          Math.max(this.moveStart.clientX - (newWidth / 2), this.moveStart.clientX - this.cropperScaledMaxWidth / 2),
          this.cropper.x2 - this.cropperScaledMinWidth
        );
        this.cropper.y1 = Math.min(
          Math.max(this.moveStart.clientY - (newHeight / 2), this.moveStart.clientY - this.cropperScaledMaxHeight / 2),
          this.cropper.y2 - this.cropperScaledMinHeight
        );
        this.cropper.x2 = Math.max(Math.min(this.moveStart.clientX + (newWidth / 2), x1 + this.cropperScaledMaxWidth / 2),
          x1 + this.cropperScaledMinWidth);
        this.cropper.y2 = Math.max(Math.min(this.moveStart.clientY + (newHeight / 2), y1 + this.cropperScaledMaxHeight / 2),
          y1 + this.cropperScaledMinHeight);
        break;
    }

    if (this.maintainAspectRatio) {
      this.checkAspectRatio();
    }
  }

  private checkAspectRatio(): void {
    let overflowX = 0;
    let overflowY = 0;

    switch (this.moveStart.position) {
      case 'top':
        this.cropper.x2 = this.cropper.x1 + (this.cropper.y2 - this.cropper.y1) * this.aspectRatio;
        overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
        overflowY = Math.max(0 - this.cropper.y1, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
        }
        break;
      case 'bottom':
        this.cropper.x2 = this.cropper.x1 + (this.cropper.y2 - this.cropper.y1) * this.aspectRatio;
        overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
        overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : (overflowX / this.aspectRatio);
        }
        break;
      case 'topleft':
        this.cropper.y1 = this.cropper.y2 - (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
        overflowX = Math.max(0 - this.cropper.x1, 0);
        overflowY = Math.max(0 - this.cropper.y1, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x1 += (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
        }
        break;
      case 'topright':
        this.cropper.y1 = this.cropper.y2 - (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
        overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
        overflowY = Math.max(0 - this.cropper.y1, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y1 += (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
        }
        break;
      case 'right':
      case 'bottomright':
        this.cropper.y2 = this.cropper.y1 + (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
        overflowX = Math.max(this.cropper.x2 - this.maxSize.width, 0);
        overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x2 -= (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
        }
        break;
      case 'left':
      case 'bottomleft':
        this.cropper.y2 = this.cropper.y1 + (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
        overflowX = Math.max(0 - this.cropper.x1, 0);
        overflowY = Math.max(this.cropper.y2 - this.maxSize.height, 0);
        if (overflowX > 0 || overflowY > 0) {
          this.cropper.x1 += (overflowY * this.aspectRatio) > overflowX ? (overflowY * this.aspectRatio) : overflowX;
          this.cropper.y2 -= (overflowY * this.aspectRatio) > overflowX ? overflowY : overflowX / this.aspectRatio;
        }
        break;
      case 'center':
        this.cropper.x2 = this.cropper.x1 + (this.cropper.y2 - this.cropper.y1) * this.aspectRatio;
        this.cropper.y2 = this.cropper.y1 + (this.cropper.x2 - this.cropper.x1) / this.aspectRatio;
        const overflowX1 = Math.max(0 - this.cropper.x1, 0);
        const overflowX2 = Math.max(this.cropper.x2 - this.maxSize.width, 0);
        const overflowY1 = Math.max(this.cropper.y2 - this.maxSize.height, 0);
        const overflowY2 = Math.max(0 - this.cropper.y1, 0);
        if (overflowX1 > 0 || overflowX2 > 0 || overflowY1 > 0 || overflowY2 > 0) {
          this.cropper.x1 += (overflowY1 * this.aspectRatio) > overflowX1 ? (overflowY1 * this.aspectRatio) : overflowX1;
          this.cropper.x2 -= (overflowY2 * this.aspectRatio) > overflowX2 ? (overflowY2 * this.aspectRatio) : overflowX2;
          this.cropper.y1 += (overflowY2 * this.aspectRatio) > overflowX2 ? overflowY2 : overflowX2 / this.aspectRatio;
          this.cropper.y2 -= (overflowY1 * this.aspectRatio) > overflowX1 ? overflowY1 : overflowX1 / this.aspectRatio;
        }
        break;
    }
  }

  private doAutoCrop(): void {
    if (this.autoCrop) {
      this.crop();
    }
  }

  crop(): ImageCroppedEvent | null {
    if (this.sourceImage && this.sourceImage.nativeElement && this.loadedImage.transformed.image != null) {
      this.startCropImage.emit();
      const imagePosition = this.getImagePosition();
      const width = imagePosition.x2 - imagePosition.x1;
      const height = imagePosition.y2 - imagePosition.y1;

      const cropCanvas = document.createElement('canvas') as HTMLCanvasElement;
      cropCanvas.width = width;
      cropCanvas.height = height;

      const ctx = cropCanvas.getContext('2d');
      if (ctx) {
        if (this.backgroundColor != null) {
          ctx.fillStyle = this.backgroundColor;
          ctx.fillRect(0, 0, width, height);
        }

        const scaleX = (this.transform.scale || 1) * (this.transform.flipH ? -1 : 1);
        const scaleY = (this.transform.scale || 1) * (this.transform.flipV ? -1 : 1);

        const transformedImage = this.loadedImage.transformed;
        ctx.setTransform(scaleX, 0, 0, scaleY, transformedImage.size.width / 2, transformedImage.size.height / 2);
        ctx.translate(-imagePosition.x1 / scaleX, -imagePosition.y1 / scaleY);
        ctx.rotate((this.transform.rotate || 0) * Math.PI / 180);
        ctx.drawImage(transformedImage.image, -transformedImage.size.width / 2, -transformedImage.size.height / 2);

        const output: ImageCroppedEvent = {
          width, height,
          imagePosition,
          cropperPosition: {...this.cropper}
        };
        if (this.containWithinAspectRatio) {
          output.offsetImagePosition = this.getOffsetImagePosition();
        }
        const resizeRatio = this.getResizeRatio(width, height);
        if (resizeRatio !== 1) {
          output.width = Math.round(width * resizeRatio);
          output.height = this.maintainAspectRatio
            ? Math.round(output.width / this.aspectRatio)
            : Math.round(height * resizeRatio);
          resizeCanvas(cropCanvas, output.width, output.height);
        }
        output.base64 = this.cropToBase64(cropCanvas);
        this.imageCropped.emit(output);
        return output;
      }
    }
    return null;
  }

  private getImagePosition(): CropperPosition {
    const sourceImageElement = this.sourceImage.nativeElement;
    const ratio = this.loadedImage.transformed.size.width / sourceImageElement.offsetWidth;

    const out: CropperPosition = {
      x1: Math.round(this.cropper.x1 * ratio),
      y1: Math.round(this.cropper.y1 * ratio),
      x2: Math.round(this.cropper.x2 * ratio),
      y2: Math.round(this.cropper.y2 * ratio)
    };

    if (!this.containWithinAspectRatio) {
      out.x1 = Math.max(out.x1, 0);
      out.y1 = Math.max(out.y1, 0);
      out.x2 = Math.min(out.x2, this.loadedImage.transformed.size.width);
      out.y2 = Math.min(out.y2, this.loadedImage.transformed.size.height);
    }

    return out;
  }

  private getOffsetImagePosition(): CropperPosition {
    const canvasRotation = this.canvasRotation + this.exifTransform.rotate;
    const sourceImageElement = this.sourceImage.nativeElement;
    const ratio = this.loadedImage.transformed.size.width / sourceImageElement.offsetWidth;
    let offsetX: number;
    let offsetY: number;

    if (canvasRotation % 2) {
      offsetX = (this.loadedImage.transformed.size.width - this.loadedImage.original.size.height) / 2;
      offsetY = (this.loadedImage.transformed.size.height - this.loadedImage.original.size.width) / 2;
    } else {
      offsetX = (this.loadedImage.transformed.size.width - this.loadedImage.original.size.width) / 2;
      offsetY = (this.loadedImage.transformed.size.height - this.loadedImage.original.size.height) / 2;
    }

    const out: CropperPosition = {
      x1: Math.round(this.cropper.x1 * ratio) - offsetX,
      y1: Math.round(this.cropper.y1 * ratio) - offsetY,
      x2: Math.round(this.cropper.x2 * ratio) - offsetX,
      y2: Math.round(this.cropper.y2 * ratio) - offsetY
    };

    if (!this.containWithinAspectRatio) {
      out.x1 = Math.max(out.x1, 0);
      out.y1 = Math.max(out.y1, 0);
      out.x2 = Math.min(out.x2, this.loadedImage.transformed.size.width);
      out.y2 = Math.min(out.y2, this.loadedImage.transformed.size.height);
    }

    return out;
  }

  private cropToBase64(cropCanvas: HTMLCanvasElement): string {
    return cropCanvas.toDataURL('image/' + this.format, this.getQuality());
  }

  private getQuality(): number {
    return Math.min(1, Math.max(0, this.imageQuality / 100));
  }

  getResizeRatio(width: number, height: number): number {
    const ratioWidth = this.resizeToWidth / width;
    const ratioHeight = this.resizeToHeight / height;
    const ratios = new Array<number>();

    if (this.resizeToWidth > 0) {
      ratios.push(ratioWidth);
    }
    if (this.resizeToHeight > 0) {
      ratios.push(ratioHeight);
    }

    const result = ratios.length === 0 ? 1 : Math.min(...ratios);

    if (result > 1 && !this.onlyScaleDown) {
      return result;
    }
    return Math.min(result, 1);
  }

  private getClientX(event: any): number {
    return (event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX) || 0;
  }

  private getClientY(event: any): number {
    return (event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY) || 0;
  }
}
