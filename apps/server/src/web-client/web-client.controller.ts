import { Controller, Get, NotFoundException, Param, Res, StreamableFile } from "@nestjs/common";
import { createReadStream, existsSync } from "node:fs";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type ResponseLike = {
  type: (contentType: string) => unknown;
};

@Controller()
export class WebClientController {
  @Get()
  getIndex(@Res({ passthrough: true }) response: ResponseLike): StreamableFile {
    return createWebClientFile("index.html", response);
  }

  @Get("viewer")
  getViewer(@Res({ passthrough: true }) response: ResponseLike): StreamableFile {
    return createWebClientFile("index.html", response);
  }

  @Get("assets/:file")
  getAsset(
    @Param("file") file: string,
    @Res({ passthrough: true }) response: ResponseLike
  ): StreamableFile {
    if (file !== basename(file)) {
      throw new NotFoundException("Asset not found");
    }

    return createWebClientFile(`assets/${file}`, response);
  }
}

export function resolveWebClientRoot(options: {
  currentDir?: string;
  envRoot?: string;
  exists?: (path: string) => boolean;
  processCwd?: string;
} = {}): string | undefined {
  const currentDir = options.currentDir ?? dirname(fileURLToPath(import.meta.url));
  const exists = options.exists ?? existsSync;
  const candidates = [
    options.envRoot ?? process.env.REMOTE_CONTROL_WEB_ROOT,
    resolve(currentDir, "../out/renderer"),
    resolve(currentDir, "../../desktop/out/renderer"),
    resolve(options.processCwd ?? process.cwd(), "apps/desktop/out/renderer")
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => exists(resolve(candidate, "index.html")));
}

export function getWebClientContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function createWebClientFile(relativePath: string, response: ResponseLike): StreamableFile {
  const webRoot = resolveWebClientRoot();
  if (!webRoot) {
    throw new NotFoundException("Web client is not built");
  }

  const filePath = resolve(webRoot, relativePath);
  const normalizedRoot = webRoot.endsWith(sep) ? webRoot : `${webRoot}${sep}`;
  if (!filePath.startsWith(normalizedRoot) || !existsSync(filePath)) {
    throw new NotFoundException("Web client file not found");
  }

  response.type(getWebClientContentType(filePath));
  return new StreamableFile(createReadStream(filePath));
}
