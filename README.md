# mdisbetter MCP server

An MCP server that lets an agent convert files. It exposes the
[mdisbetter.com](https://mdisbetter.com) converter over stdio: 3649 proven
conversions across 162 input formats. Images, documents, ebooks, audio,
video, office files, fonts, archives, data formats, subtitles and
bibliographies. Eleven families, in and out, not only to PDF.

Two tools, and that is the whole surface:

| Tool | What it does |
| --- | --- |
| `convert_file` | Takes a path and an output format, writes the converted file, returns its path. |
| `list_conversions` | With an extension, the output formats proven for it. Without, every input extension accepted. |

## What it does not do

This list is here because the opposite claim is easy to make by accident.
The server has no batch mode, no webhooks, no job polling, no queue, no
streaming, no URL input, and no CLI beyond the stdio entry point. It
converts one local file per call, and waits for the answer.

It used to say "no audio or video conversion" here. That stopped being
true when the conversion table was resynchronised: audio and video are
served like every other family. Video that has to be re-encoded is capped
at 120 seconds of source, because a re-encode costs real CPU; a container
change that keeps the codecs is a stream copy and has no such limit.

## Requirements

- Node.js 20 or later.
- An mdisbetter.com API key. Keys start with `mdb_sk_`.

Create one from your dashboard, under API keys. The plaintext key is
shown once and never again: only its hash is stored, so nobody can
recover it for you, us included. Store it before closing the panel.

Conversions cost credits from the same balance the website spends. There
is no separate quota for programmatic use.

## Install

```bash
git clone https://github.com/dresseurmonster2-oss/mdisbetter-mcp.git
cd mdisbetter-mcp
npm install
```

Or run it without cloning:

```bash
npx -y github:dresseurmonster2-oss/mdisbetter-mcp
```

## Configure

Two environment variables, one of them optional.

| Variable | Required | Meaning |
| --- | --- | --- |
| `MDISBETTER_API_KEY` | yes | Your key, starting with `mdb_sk_`. |
| `MDISBETTER_BASE_URL` | no | Defaults to `https://mdisbetter.com`. Point it at a preview deployment to test against one. |

The key is read from the environment and from nowhere else. It is never
a tool argument, so no prompt can talk the model into revealing it, and
the server never writes it to a file.

## Wire it into a client

Most MCP clients read a JSON block like this one. The path is wherever
you cloned the repository.

```json
{
  "mcpServers": {
    "mdisbetter": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-server/src/index.js"],
      "env": {
        "MDISBETTER_API_KEY": "mdb_sk_your_key_here"
      }
    }
  }
}
```

Restart the client. `list_conversions` and `convert_file` appear in its
tool list.

## The tools

### `list_conversions`

```jsonc
// every input format the converter accepts
{ "name": "list_conversions", "arguments": {} }

// what a .docx can become
{ "name": "list_conversions", "arguments": { "extension": "docx" } }
```

The extension may be written with or without its dot, in any case.
`.DOCX`, `docx` and `.docx` are the same question.

An extension the converter cannot read is refused, rather than answered
with an empty list.

### `convert_file`

```jsonc
{
  "name": "convert_file",
  "arguments": {
    "path": "/home/me/report.docx",
    "target": "pdf"
  }
}
```

| Argument | Required | Meaning |
| --- | --- | --- |
| `path` | yes | The file to convert, on the machine running this server. |
| `target` | yes | Output format as a bare extension: `pdf`, `png`, `md`. |
| `output_path` | no | Where to write the result. Overwrites if it exists. |

Without `output_path`, the result lands beside the input with the new
extension: `report.docx` becomes `report.pdf` in the same directory. If
that name is taken the server writes `report-1.pdf` instead. It never
overwrites a file it was not pointed at, and it never touches the input.

Files are capped at 150 MB, which is what the conversion engine accepts.

Under 4 MB the file travels in the request itself, which is one round
trip. Above it, the server uploads to storage first and sends only the
address, because the platform hosting the API caps a request body AND a
response body at 4.5 MB. Measured on 31/08/2026 in 100 KB steps: 4.2 MB
passes, 4.3 MB returns a 413 raised before the function even runs. This
README claimed 25 MB until that day, a figure taken from the engine and
never reachable through the transport.

A pair that is not in the table is refused before anything is sent, and
the refusal lists the targets that would work:

```
.png to .docx is not a proven conversion. Proven targets for .png (28):
avif, bmp, dds, eps, gif, hdr, ico, jng, jp2, jpeg, jpg, miff, pbm, pcx,
pdf, pgm, pnm, ppm, ps, psd, ras, sgi, tga, tif, tiff, wbmp, webp, xpm.
```

## When the file does not come back

The server translates each answer rather than passing along a bare
status code.

| Situation | What the agent is told |
| --- | --- |
| Out of credits | How many credits the conversion costs, how many remain, how many are missing, and the top-up page. This is not a fault: the account is simply out of credits, and the conversion did not happen. |
| Key rejected | The key is missing, invalid, or revoked. Set `MDISBETTER_API_KEY`. |
| File refused | The pair is proven, so the file itself is the problem: contents that do not match the extension, or something the engine could not read. |
| File too large | Over the 150 MB the engine accepts. |
| Converter at capacity | The service sheds load on purpose rather than degrading. Nothing broke, nothing was charged, retry in a few seconds. |
| Service unavailable or timed out | Said plainly, and no file is written. |

Nothing is ever written to disk unless a converted file actually came
back with bytes in it.

## Where the conversion table comes from

`src/formats.js` is a copy of the table the website itself uses. It is
generated, not written by hand, and it contains only pairs that a probe
converted for real and then read back, checking the output was the format
it claims to be. Formats an engine merely advertises do not make it in.

Do not edit it. Regenerate it in the main repository:

```bash
python scripts/generer-formats.py
```

That rewrites `site/content/formats.js` from the probe results, and the
file is then copied here unchanged, keeping its original header.

The table maps each pair to one of four endpoints, chosen by what serves
that pair best rather than by the file's family:

| Endpoint | Pairs | Typically |
| --- | --- | --- |
| `/api/convert-image` | 1189 | image to image |
| `/api/convert-media` | 1117 | audio and video |
| `/api/convert-document` | 895 | markup and document formats |
| `/api/convert-ebook` | 298 | ebook and reader formats |
| `/api/convert-office` | 41 | office documents, spreadsheets and slides |
| `/api/convert-archive` | 30 | archives: ZIP, TAR and its compressions, 7z |
| `/api/convert-subtitle` | 25 | subtitles: SRT, VTT, ASS, SSA, LRC and TTML |
| `/api/convert-data` | 24 | data formats: JSON, YAML, TOML, CSV, TSV, NDJSON |
| `/api/convert-font` | 18 | fonts: TrueType, OpenType, WOFF and WOFF2 |
| `/api/convert-bibliography` | 12 | bibliographies: BibTeX, BibLaTeX, CSL JSON, RIS and EndNote XML |

These counts are checked against the table by `test/readme.test.mjs`. The
table itself is generated from probes against the real engine, so a stale
number here means the README was not updated, never that the table is
wrong.

Several extensions could be served by more than one of these. A `.docx`
to PDF goes through the office endpoint because that keeps the layout,
while `.docx` to Markdown goes through the document endpoint because that
keeps the text faithful. The caller never has to know: it names a file and
a target format.

## Tests

```bash
npm test
```

The suite runs offline. It spawns the server as a real process and speaks
MCP to it over stdio, checks the routing of every one of the 3649 pairs,
checks that an unproven pair is refused before any request is made, and
checks the wording of each answer, including that running out of credits
is never described as a failure.

The tests do not perform a real conversion. That needs a key and a
credit balance, neither of which belongs in a test suite.

## License

MIT. See [LICENSE](LICENSE).

The converter itself is a hosted service; this repository is the
connector that reaches it. Conversions cost credits from your
mdisbetter.com balance.
