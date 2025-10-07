import argparse
import os
import sys
import shutil
import cv2
import numpy as np
import tifffile
import matplotlib.pyplot as plt

def load_config():
    """从 YAML 或 JSON 文件加载配置。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='config.yaml', help='配置文件路径 (yaml/yml/json)')
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
                raise RuntimeError('不支持的配置文件扩展名')
    except FileNotFoundError:
        print(f"错误: 在 {config_path} 未找到配置文件", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误: 加载配置文件失败: {e}", file=sys.stderr)
        sys.exit(1)

def process_image(image_path, downsample_percentile_low=1, downsample_percentile_high=99):
    """
    处理图像：如果图像位深度 > 8-bit，则进行归一化。
    返回一个元组：(处理后的图像, 一个布尔值表示是否执行了归一化)。
    """
    try:
        was_normalized = False  # 初始化标志
        
        # 1. 读取图像
        if image_path.lower().endswith(('.tif', '.tiff')):
            img_raw = tifffile.imread(image_path)
        else:
            img_raw = cv2.imread(image_path, cv2.IMREAD_UNCHANGED)

        if img_raw is None:
            raise IOError("加载图像失败")

        # 2. 判断是否需要归一化
        if img_raw.dtype == np.uint8:
            processed_img = img_raw
            was_normalized = False
        elif np.issubdtype(img_raw.dtype, np.integer):
            was_normalized = True
            print(f"  类型: >8-bit ({img_raw.dtype})。正在归一化...")
            p_low_val = np.percentile(img_raw, downsample_percentile_low)
            p_high_val = np.percentile(img_raw, downsample_percentile_high)
            
            if p_high_val <= p_low_val:
                processed_img = np.zeros_like(img_raw, dtype=np.uint8)
            else:
                clipped_img = np.clip(img_raw, p_low_val, p_high_val)
                scaled_img = (clipped_img - p_low_val) * (255.0 / (p_high_val - p_low_val))
                processed_img = scaled_img.astype(np.uint8)
        else:
            print(f"  警告: 不支持的图像数据类型 {img_raw.dtype}。已跳过。")
            return None, False

        # 3. 确保输出为3通道BGR图像以便统一处理
        if len(processed_img.shape) == 2:
            final_img = cv2.cvtColor(processed_img, cv2.COLOR_GRAY2BGR)
        elif len(processed_img.shape) == 3 and processed_img.shape[2] == 4:
            final_img = cv2.cvtColor(processed_img, cv2.COLOR_RGBA2BGR)
        else:
            final_img = processed_img

        return final_img, was_normalized

    except Exception as e:
        print(f"处理 '{os.path.basename(image_path)}' 时出错: {e}", file=sys.stderr)
        return None, False

def plot_histogram(image, title, ax):
    """
    为给定图像绘制直方图，并根据其位深度和通道数自动调整。
    针对高位深单通道图像使用matplotlib.hist进行正确绘制。
    """
    if image is None:
        return

    # 1. 根据图像数据类型确定直方图范围
    if image.dtype == np.uint8:
        hist_range = [0, 256]
        xlabel = "像素值 (8-bit)"
    elif image.dtype == np.uint16:
        hist_range = [0, 65536]
        xlabel = "像素值 (16-bit)"
    elif image.dtype == np.uint32:
        hist_range = [0, 2**32]
        xlabel = "像素值 (32-bit)"
    else:  # 其他类型的回退方案
        min_val, max_val = np.min(image), np.max(image)
        hist_range = [min_val, max_val + 1]
        xlabel = f"像素值 ({image.dtype})"
        if min_val == max_val:
            hist_range = [min_val, min_val + 1]

    # 2. 根据通道数选择不同的绘图方法
    # 对于3通道图像，使用cv2.calcHist，因为它能方便地分离颜色
    if len(image.shape) == 3 and image.shape[2] in [3, 4]:
        colors = ('b', 'g', 'r')
        for i, col in enumerate(colors):
            # 对于8-bit RGB图像，256个bins和[0, 256]的范围是匹配的，所以plot可以正确工作
            hist = cv2.calcHist([image], [i], None, [256], hist_range)
            ax.plot(hist, color=col, label=f'Channel {i}')
        ax.legend()
    # 对于单通道图像，使用matplotlib.hist以确保X轴正确缩放
    else:
        # 使用 image.ravel() 将2D图像数据展平成1D数组
        # bins=256 提供了足够的可视化粒度
        ax.hist(image.ravel(), bins=256, range=hist_range, color='black')

    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel("频数")
    ax.set_xlim(hist_range)
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
        print(f"错误: 输入文件夹不存在于 {input_folder_path}", file=sys.stderr)
        sys.exit(1)
        
    if output_image_format not in ['tif', 'png', 'jpg', 'jpeg']:
        print(f"不支持的输出图像格式: {output_image_format}")
        sys.exit(1)

    # 准备输出目录
    main_output_folder = os.path.join(output_root_folder, 'processed_images')
    input_histograms_folder = os.path.join(output_root_folder, 'input_histograms')
    output_histograms_folder = os.path.join(output_root_folder, 'output_histograms')

    if os.path.exists(output_root_folder): shutil.rmtree(output_root_folder)
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
            base_name = os.path.splitext(relative_path)[0].replace('\\', '/')

            print(f"正在处理: {relative_path}")
            
            try:
                img_original = tifffile.imread(input_file_path) if file_ext in ('.tif', '.tiff') else cv2.imread(input_file_path, cv2.IMREAD_UNCHANGED)
                if img_original is None: raise IOError("加载原始图像失败")
            except Exception as e:
                print(f"  加载原始图像时出错: {e}", file=sys.stderr)
                failed_files.append(relative_path)
                continue

            img_processed, was_normalized = process_image(
                input_file_path,
                downsample_percentile_low,
                downsample_percentile_high
            )

            if img_processed is None:
                failed_files.append(relative_path)
                continue

            if save_input_histogram:
                hist_title = "Input Histogram (Original)" if was_normalized else "Image Histogram"
                hist_filename = base_name + '_input_histogram.png' if was_normalized else base_name + '_histogram.png'
                hist_path = os.path.join(input_histograms_folder, hist_filename)
                
                os.makedirs(os.path.dirname(hist_path), exist_ok=True)
                fig, ax = plt.subplots(figsize=(8, 6))
                plot_histogram(img_original, hist_title, ax)
                plt.tight_layout()
                fig.savefig(hist_path)
                plt.close(fig)
                print(f"  输入直方图已保存至: {hist_path}")

            if was_normalized:
                output_save_path = os.path.join(main_output_folder, base_name + '.' + output_image_format)
                os.makedirs(os.path.dirname(output_save_path), exist_ok=True)
                
                try:
                    if output_image_format == 'tif':
                        tifffile.imwrite(output_save_path, cv2.cvtColor(img_processed, cv2.COLOR_BGR2RGB))
                    else:
                        cv2.imwrite(output_save_path, img_processed)
                except Exception as e:
                    print(f"  保存图像 '{output_save_path}' 时出错: {e}", file=sys.stderr)
                    failed_files.append(output_save_path + " (保存失败)")
                    continue

                if save_output_histogram:
                    hist_path = os.path.join(output_histograms_folder, base_name + '_output_histogram.png')
                    os.makedirs(os.path.dirname(hist_path), exist_ok=True)
                    fig, ax = plt.subplots(figsize=(8, 6))
                    plot_histogram(img_processed, "Output Histogram (Normalized)", ax)
                    plt.tight_layout()
                    fig.savefig(hist_path)
                    plt.close(fig)
                    print(f"  输出直方图已保存至: {hist_path}")
            else:
                print("  类型: 8-bit 图像。无需归一化，不保存图像文件。")

            processed_count += 1

    print(f"\n--- 处理总结 ---")
    print(f"已处理: {processed_count}\n失败: {len(failed_files)}\n跳过: {len(skipped_files)}")
    if failed_files:
        print("\n失败文件列表:")
        for f in failed_files: print(f"  - {f}")
    if skipped_files:
        print("\n跳过文件列表:")
        for f in skipped_files: print(f"  - {f}")