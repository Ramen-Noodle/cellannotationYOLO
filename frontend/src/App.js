import { useEffect, useState } from "react";

function App() {
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/hello")        // <-- no localhost:5000 needed
      .then(res => res.json())
      .then(data => setMsg(data.message));
  }, []);

  return <div>{msg}</div>;
}

export default App;
