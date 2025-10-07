import argparse
import os
import sys
import shutil
import cv2
import numpy as np
import tifffile
import matplotlib.pyplot as plt

def load_config():
    """Load configuration from a YAML or JSON file."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='config.yaml', help='Config file path (yaml/yml/json)')
    args = parser.parse_args()
    config_path = args.config
    try:
        with open(config_path, 'r') as f:
            if config_path.lower().endswith(('.yaml', '.yml')):
                import yaml
                return yaml.safe_load(f)
            elif config_path.lower().endswith('.json'):
                import json
                return json.load(f)
            else:
                raise RuntimeError('Unsupported config file extension')
    except FileNotFoundError:
        print(f"Error: Config file not found at {config_path}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error loading config file: {e}", file=sys.stderr)
        sys.exit(1)

def convert_to_8bit_if_needed(image_path, downsample_percentile_low=1, downsample_percentile_high=99):
    """
    Loads an image and converts it to 8-bit if it's a single-channel image with a higher bit depth.
    RGB 8-bit images are passed through without conversion.
    """
    try:
        # Load image based on file extension
        if image_path.lower().endswith(('.tif', '.tiff')):
            img_raw = tifffile.imread(image_path)
            # Tifffile returns (H, W) or (H, W, C).
        else:
            # For other formats, use OpenCV
            img_raw = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)
            if img_raw is None:
                return None

        # Check for 8-bit RGB/RGBA images
        if img_raw.dtype == np.uint8 and len(img_raw.shape) == 3:
            if img_raw.shape[2] == 3:  # 8-bit RGB
                print(f"  Skipping downsample: 8-bit RGB image detected.")
                return img_raw
            elif img_raw.shape[2] == 4:  # 8-bit RGBA
                print(f"  Skipping downsample: 8-bit RGBA image detected, converting to BGR.")
                return cv2.cvtColor(img_raw, cv2.COLOR_RGBA2BGR)
        
        # Handle single-channel images of any bit depth
        if len(img_raw.shape) == 2 or (len(img_raw.shape) == 3 and img_raw.shape[2] == 1):
            if img_raw.dtype == np.uint8:
                # 8-bit single-channel image, convert to 3-channel BGR for consistency
                return cv2.cvtColor(img_raw, cv2.COLOR_GRAY2BGR)
            else:
                # Downsample higher bit-depth single-channel images to 8-bit
                print(f"  Downsampling from {img_raw.dtype} to 8-bit.")
                p_low_val = np.percentile(img_raw, downsample_percentile_low)
                p_high_val = np.percentile(img_raw, downsample_percentile_high)
                
                if p_high_val == p_low_val:
                    converted_img = np.zeros_like(img_raw, dtype=np.uint8)
                    if p_high_val > 0:
                        converted_img.fill(255)
                else:
                    converted_img = (np.clip(img_raw, p_low_val, p_high_val) - p_low_val) * (255.0 / (p_high_val - p_low_val))
                    converted_img = converted_img.astype(np.uint8)
                
                return cv2.cvtColor(converted_img, cv2.COLOR_GRAY2BGR)
        
        # For other unsupported formats (e.g., higher bit-depth multi-channel images)
        print(f"  Warning: Unsupported image type with shape {img_raw.shape} and dtype {img_raw.dtype}. Skipping.")
        return None

    except Exception as e:
        print(f"Error converting '{os.path.basename(image_path)}' to 8-bit: {e}", file=sys.stderr)
        return None

def plot_histogram(image, title, ax, color_map=('b','g','r')):
    """Plots a histogram for a given image."""
    if image is None:
        return
    if len(image.shape) == 3:
        for i, col in enumerate(color_map):
            hist = cv2.calcHist([image], [i], None, [256], [0, 256])
            ax.plot(hist, color=col)
    else:
        hist = cv2.calcHist([image], [0], None, [256], [0, 256])
        ax.plot(hist, color='black')
    ax.set_title(title)
    ax.set_xlabel("Pixel Value")
    ax.set_ylabel("Frequency")
    ax.set_xlim([0, 256])
    ax.grid(True, linestyle='--', alpha=0.6)

if __name__ == "__main__":
    config = load_config()

    input_folder_path = config.get('input_folder')
    output_root_folder = config.get('output_folder')
    output_image_format = config.get('output_format', 'tif').lower().replace('tiff', 'tif')
    downsample_percentile_low  = float(config.get('downsample_percentile_low', 1))
    downsample_percentile_high = float(config.get('downsample_percentile_high', 99))
    save_input_histogram  = bool(config.get('save_input_histogram', True))
    save_output_histogram = bool(config.get('save_output_histogram', True))

    if not input_folder_path or not os.path.exists(input_folder_path):
        print(f"Error: Input folder not found at {input_folder_path}", file=sys.stderr)
        sys.exit(1)
        
    if output_image_format not in ['tif', 'png', 'jpg', 'jpeg']:
        print(f"Unsupported output image format: {output_image_format}")
        sys.exit(1)

    # Prepare output directories
    main_output_folder = os.path.join(output_root_folder, '8bit_results')
    input_histograms_folder = os.path.join(output_root_folder, 'input_histograms')
    output_histograms_folder = os.path.join(output_root_folder, 'output_histograms')

    if os.path.exists(output_root_folder):
        shutil.rmtree(output_root_folder)
    os.makedirs(main_output_folder, exist_ok=True)
    if save_input_histogram: os.makedirs(input_histograms_folder, exist_ok=True)
    if save_output_histogram: os.makedirs(output_histograms_folder, exist_ok=True)

    supported_exts = ('.tif', '.tiff', '.png', '.jpg', '.jpeg')
    processed_count, failed_files, skipped_files = 0, [], []

    for root, dirs, files in os.walk(input_folder_path):
        for filename in files:
            file_ext = os.path.splitext(filename)[1].lower()
            if file_ext not in supported_exts:
                skipped_files.append(os.path.join(root, filename))
                continue
            input_file_path = os.path.join(root, filename)
            relative_path = os.path.relpath(input_file_path, input_folder_path)
            base_name = os.path.splitext(relative_path)[0]

            print(f"Processing: {relative_path}")
            
            # Call the main conversion function
            final_img_8bit = convert_to_8bit_if_needed(
                input_file_path,
                downsample_percentile_low, downsample_percentile_high
            )

            if final_img_8bit is None:
                failed_files.append(relative_path)
                print(f"  Failed to convert/process {relative_path}")
                continue

            # Output 8-bit image
            output_relative_path = base_name + '.' + output_image_format
            output_save_path = os.path.join(main_output_folder, output_relative_path)
            os.makedirs(os.path.dirname(output_save_path), exist_ok=True)
            
            ok = False
            # Special handling for tifffile
            if output_image_format == 'tif':
                try:
                    # Tifffile expects RGB order
                    tifffile.imwrite(output_save_path, cv2.cvtColor(final_img_8bit, cv2.COLOR_BGR2RGB))
                    ok = True
                except Exception as e:
                    print(f"Error saving TIFF file: {e}", file=sys.stderr)
                    ok = False
            else:
                # OpenCV handles PNG/JPG directly in BGR format
                ok = cv2.imwrite(output_save_path, final_img_8bit)
            
            if not ok:
                failed_files.append(output_save_path + " (save failed)")
                continue

            # Create and save histograms
            # Note: The original code's histogram plotting logic was flawed;
            # it was plotting the output image histogram twice.
            # Here we need to load the original image again for a correct input histogram.
            
            # Plot and save input histogram
            if save_input_histogram:
                input_hist_plot_filename = base_name + '_input_histogram.png'
                input_hist_plot_save_path = os.path.join(input_histograms_folder, input_hist_plot_filename)
                os.makedirs(os.path.dirname(input_hist_plot_save_path), exist_ok=True)
                
                # Re-load the original image for plotting the input histogram
                img_input_plot = tifffile.imread(input_file_path) if input_file_path.lower().endswith(('.tif', '.tiff')) else cv2.imread(input_file_path, cv2.IMREAD_UNCHANGED)
                
                fig, ax = plt.subplots(figsize=(6, 4))
                plot_histogram(img_input_plot, "Input Image Histogram", ax)
                plt.tight_layout()
                try:
                    fig.savefig(input_hist_plot_save_path)
                    print(f"  Input histogram saved to {input_hist_plot_save_path}")
                except Exception as e:
                    failed_files.append(input_hist_plot_save_path + " (input histogram plot failed)")
                    print(f"  Error saving input histogram: {e}", file=sys.stderr)
                finally:
                    plt.close(fig)

            # Plot and save output histogram
            if save_output_histogram:
                output_hist_plot_filename = base_name + '_output_histogram.png'
                output_hist_plot_save_path = os.path.join(output_histograms_folder, output_hist_plot_filename)
                os.makedirs(os.path.dirname(output_hist_plot_save_path), exist_ok=True)
                
                fig, ax = plt.subplots(figsize=(6, 4))
                plot_histogram(final_img_8bit, "Output Image Histogram", ax)
                plt.tight_layout()
                try:
                    fig.savefig(output_hist_plot_save_path)
                    print(f"  Output histogram saved to {output_hist_plot_save_path}")
                except Exception as e:
                    failed_files.append(output_hist_plot_save_path + " (output histogram plot failed)")
                    print(f"  Error saving output histogram: {e}", file=sys.stderr)
                finally:
                    plt.close(fig)

            processed_count += 1

    print(f"\n--- Processing Summary ---")
    print(f"Processed: {processed_count}")
    print(f"Failed: {len(failed_files)}")
    print(f"Skipped: {len(skipped_files)}")
    if failed_files:
        print("\nFailed Files:")
        for f in failed_files:
            print(f"  - {f}")
    if skipped_files:
        print("\nSkipped Files (unsupported extensions):")
        for f in skipped_files:
            print(f"  - {f}")