/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("#app element is missing from index.html");

render(() => <App />, root);
