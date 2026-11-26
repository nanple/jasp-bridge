#!/usr/bin/env node
import { capabilitiesMarkdown, getCapabilities } from "../jasp/detect.js";

const caps = getCapabilities({ refresh: true });
console.log(capabilitiesMarkdown(caps));
console.log("");
console.log(JSON.stringify(caps, null, 2));
