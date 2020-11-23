import { CropperOptions, OutputFormat } from './cropper-options.interface';
import { ImageTransform } from './image-transform.interface';

export class CropperSettings {
  format: OutputFormat = 'png';
  maintainAspectRatio = true;
  transform: ImageTransform = {};
  aspectRatio = 1;
  resizeToWidth = 0;
  resizeToHeight = 0;
  cropperMinWidth = 0;
  cropperMinHeight = 0;
  cropperMaxHeight = 0;
  cropperMaxWidth = 0;
  cropperStaticWidth = 0;
  cropperStaticHeight = 0;
  canvasRotation = 0;
  initialStepSize = 3;
  roundCropper = false;
  onlyScaleDown = false;
  imageQuality = 92;
  autoCrop = true;
  backgroundColor: string;
  containWithinAspectRatio = false;
  hideResizeSquares = false;
  alignImage: 'left' | 'center' = 'center';

  setOptions(options: CropperOptions): void {
    Object.keys(options).forEach((k) => this[k] = options[k]);
  }
}
