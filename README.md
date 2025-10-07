# Cell Annotation Tool (CAT 🐱)

The **Cell Annotation Tool (CAT)** is a web-based graphical user interface (GUI) developed to facilitate both automated and manual cell annotation. The primary objective is to enable biologists with little to no programming experience to deploy and use machine learning models for object detection in microscopy images — specifically targeting SGN, MADM, and CD3 cell types.

The tool uses **YOLOv11 (Ultralytics)** for detection.

![Screenshot](https://i.ibb.co/HT352zqk/Screenshot-2025-10-07-154546.png)

---

## Overview

CAT is implemented using **Flask**, a lightweight Python web framework, along with **HTML** and **JavaScript** for the front-end interface.  
- The **front-end** handles user interaction and visualization.  
- The **back-end** (Flask) manages model inference and data operations.

Upon uploading an image, CAT performs automated detection and displays annotated bounding boxes for each identified cell. Users can manually refine these annotations (add, delete, or move bounding boxes) and save the updated data for model fine-tuning.

---

## Features

### 🔹 Model Integration and Testing
- Upload and assign custom object detection models to one of the supported categories (SGN, MADM, CD3).  
- Compare your custom models with built-in baseline models.  
- Fine-tune models directly within the interface using previously saved annotated data.

### 🔹 Multi-user Support
- Supports **concurrent user sessions**, each with a unique session ID and isolated data directory.  
- Prevents overlap between users’ data.  
- Restricts training to one active session per user to manage GPU/CPU load efficiently.

### 🔹 Data Export
- Export annotated datasets as a `.zip` archive containing:
  - Original uploaded image  
  - Corresponding annotation files (`.txt` format for YOLO)

### 🔹 Visualization and Customization
- Adjustable **bounding box colors** for each class  
- **Brightness** and **contrast** adjustment for image clarity  
- **Zoom**, **crop**, and **scale** functionalities (toggle zoom with the **Esc** key)  
- Adjustable **detection threshold** to control sensitivity during inference

### 🔹 Image Conversion
- Converts high-resolution `.tiff` images to `.png` format for easier visualization and sharing.  
- Conversion slightly reduces resolution but improves portability and responsiveness.

---

## Installation (Linux Tested)

1. Ensure **YOLOv11** (Ultralytics) is installed:
   ```bash
   pip install ultralytics

## Deployment

Go to the root directory where the repository is cloned, and then in the python environment launch the following:

``` bash
python app.py
```


This will launch the web application on port 5001. By default, it runs on a static IP address and can be accessed either locally or by multiple users via a VPN connection.  

Access the interface using one of the following URLs:
- **Localhost:** [http://localhost:5001/static/index.html](http://localhost:5001/static/index.html)
- **GPU Server (internal):** [http://(your static IP):5001/static/index.html](http://10.80.24.12:5001/static/index.html)

> **Note:** These links are only active while `app.py` is running on the host server.

---

## How to Use

1. **Upload** an image.  
2. Adjust image settings — scale, zoom, crop, or modify brightness and contrast as needed.  
3. Run **detection** using the desired model; adjust the detection threshold if required.  
4. **Edit annotations** by clicking and dragging to add new bounding boxes, or right-clicking to remove existing ones.  
5. **Save training data** by clicking “Save Training Data.” This stores updated images and annotations on the backend.  
6. Repeat the annotation and saving process for multiple images as needed.  
7. **Fine-tune the model** by selecting “Fine-tune (Saved Data),” which retrains the base detection model using the saved dataset.  
8. Upon completion, a **k-fold validation score** and a **.pt model file** are generated for download and further testing.  
9. **Test the fine-tuned model** by either:  
   - Clicking “Custom Detect” and uploading the newly generated `.pt` file, or  
   - Selecting the model from the dropdown menu and clicking “Detect with Fine-tuned Model.”  




## Acknowledgements

 - [COMBINe: Cell detectiOn in Mouse BraIN](https://github.com/yccc12/COMBINe/tree/main)
 - [keras-retinanet](https://github.com/fizyr/keras-retinanet)

