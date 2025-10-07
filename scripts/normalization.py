# normalization.py - for frontend
import numpy as np
from PIL import Image
import tifffile

def normalize_image(input_path, output_path, low_percentile=1, high_percentile=99):
    """Normalize an image file and save the result using improved percentile-based scaling"""
    try:
        # Read image
        if input_path.lower().endswith(('.tif', '.tiff')):
            img_array = tifffile.imread(input_path)
        else:
            img = Image.open(input_path)
            img_array = np.array(img)
        
        # Check if normalization is needed
        if img_array.dtype == np.uint8:
            # Already 8-bit, just convert to RGB if needed
            if len(img_array.shape) == 2:
                img_array = np.stack((img_array,) * 3, axis=-1)
            result = Image.fromarray(img_array)
        elif np.issubdtype(img_array.dtype, np.integer):
            # Normalize >8-bit images
            p_low = np.percentile(img_array, low_percentile)
            p_high = np.percentile(img_array, high_percentile)
            
            if p_high <= p_low:
                # Edge case: all values are the same or percentiles are invalid
                normalized = np.zeros_like(img_array, dtype=np.uint8)
            else:
                # Clip and scale to [0,255], convert to uint8
                clipped = np.clip(img_array, p_low, p_high)
                normalized = ((clipped - p_low) * 255.0 / (p_high - p_low)).astype(np.uint8)
            
            # Ensure 3-channel output
            if len(normalized.shape) == 2:
                normalized = np.stack((normalized,) * 3, axis=-1)
            
            result = Image.fromarray(normalized)
        else:
            # For non-integer types, just convert to RGB
            img = Image.open(input_path)
            if img.mode != 'RGB':
                result = img.convert('RGB')
            else:
                result = img
        
        result.save(output_path)
        return True
        
    except Exception as e:
        print(f"Error normalizing image: {str(e)}")
        # Fallback to simple conversion
        try:
            img = Image.open(input_path)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img.save(output_path)
            return True
        except:
            return False