import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { auth } from "./lib/firebase";
import App from "./App";
import "./index.css";

setAuthTokenGetter(async () => {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
});

createRoot(document.getElementById("root")!).render(<App />);
