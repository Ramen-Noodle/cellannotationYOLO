import { useEffect, useState } from "react";
import { Box, Button } from "@mui/material";
import SideMenu from "./components/SideMenu";
import ImageCanvas from "./components/ImageCanvas";

function App() {
  const [msg, setMsg] = useState("");
  const [imageURL, setImageURL] = useState("");
  const [boxes, setBoxes] = useState([]);

  useEffect(() => {
    fetch("/api/hello")
      .then(res => res.json())
      .then(data => setMsg(data.message));
  }, []);

  function showMeTheBoxes() {
    console.log(boxes)
  }

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.tiff') && !file.name.toLowerCase().endsWith('.tif')) {
        alert('Only .tiff and .tif files are accepted.');
        e.target.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch("/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        setImageURL(data.converted_url)
        setBoxes([])
    } catch {

    }
  }

  const handleAddBox = (box) => {
    if (imageURL) {
      setBoxes(prev => [...prev, box]);
    }
  };

  const handleRemoveBox = (box) => {
    setBoxes(prev => prev.filter(b => b !== box));
  };

  return (
    <Box sx={{ display: "flex", height: "100vh", width: "100vw" }}>
      <SideMenu>
        <Button variant="contained" component="label">
          Load Image
          <input hidden type="file" accept="image/tiff" onChange={handleUpload} />
        </Button>
        <Button variant="contained" component="label" onClick={showMeTheBoxes}>
          Show me the boxes
        </Button>
      </SideMenu>

      <Box
				sx={{
					flexGrow: 1,
					display: "flex",
					justifyContent: "center",
					bgcolor: "#111",
				}}
			>
        <ImageCanvas src={imageURL} boxes={boxes} onAddBox={handleAddBox} onRemoveBox={handleRemoveBox}></ImageCanvas>
      </Box>
    </Box>
  );
}

export default App;
