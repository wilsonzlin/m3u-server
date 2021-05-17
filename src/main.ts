#!/usr/bin/env node

import withoutUndefined from "extlib/js/withoutUndefined";
import pathExtension from "extlib/js/pathExtension";
import recursiveReaddir from "extlib/js/recursiveReaddir";
import { createReadStream, Stats } from "fs";
import * as http from "http";
import { Command } from "sacli";
import { join } from "path";
import { stat } from "fs/promises";
import * as FileType from "file-type";
import { pipeline } from "stream";

const DEFAULT_EXTENSIONS = [
  "aac",
  "aiff",
  "av1",
  "avi",
  "heic",
  "m2v",
  "m4a",
  "m4v",
  "mkv",
  "mp2",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "ogf",
  "ogg",
  "rm",
  "rmvb",
  "wav",
  "webm",
  "wma",
  "wmv",
].join(",");

const cli = Command.new()
  .optional("extensions", String)
  .required("hostname", String)
  .optional("library", String, { default: true })
  .required("port", Number)
  .action(
    async ({
      extensions = DEFAULT_EXTENSIONS,
      hostname,
      library = process.cwd(),
      port,
    }) => {
      const allowedExtensions = new Set(extensions.split(","));
      const files: {
        path: string;
        stats: Stats;
        mime: FileType.FileTypeResult | undefined;
      }[] = [];
      const m3uLines = ["#EXTM3U", ""];
      for await (const file of recursiveReaddir(library)) {
        if (allowedExtensions.has(pathExtension(file).slice(1))) {
          const path = join(library, file);
          const id =
            files.push({
              path,
              stats: await stat(path),
              mime: await FileType.fromFile(path),
            }) - 1;
          console.log(`Found file ${file}`);
          m3uLines.push(
            `#EXTINF:-1,${file}`,
            `http://${hostname}:${port}/${id}`,
            ""
          );
        }
      }
      http
        .createServer((req, res) => {
          const idRaw = req.url?.slice(1) ?? "";
          if (!idRaw) {
            return res
              .writeHead(200, {
                "Content-Type": "audio/x-mpegurl",
              })
              .end(m3uLines.join("\n"));
          }

          const id = Number.parseInt(idRaw, 10);
          if (!Number.isSafeInteger(id) || id < 0 || id >= files.length) {
            return res.writeHead(404).end();
          }

          const { mime, path, stats } = files[id];

          let start, end;
          const { range } = req.headers;
          if (range) {
            const rangeParts = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)?$/.exec(
              range
            );
            if (!rangeParts) {
              return res.writeHead(400).end(`Malformed range`);
            }
            start = Number.parseInt(rangeParts[1], 10);
            end = rangeParts[2]
              ? Number.parseInt(rangeParts[2], 10)
              : stats.size - 1;
          } else {
            start = 0;
            end = stats.size - 1;
          }

          const streamLength = end - start + 1;
          if (
            start < 0 ||
            start > end ||
            end < 1 ||
            end >= stats.size ||
            streamLength < 1
          ) {
            return res.writeHead(416).end(`Invalid range: ${start}-${end}`);
          }

          res.writeHead(
            206,
            withoutUndefined({
              "Accept-Ranges": "bytes",
              "Content-Length": streamLength,
              "Content-Range": `bytes ${start}-${end}/${stats.size}`,
              "Content-Type": mime?.mime,
            })
          );

          pipeline(
            createReadStream(path, { start, end, autoClose: true }),
            res,
            (err) => {
              if (err) console.warn(err);
            }
          );
        })
        .listen(port, () => console.log(`Server started on port ${port}`));
    }
  );

cli.eval(process.argv.slice(2));
