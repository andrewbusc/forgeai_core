const canonicalBackendStarter = {
    "README.md": `# deeprun Canonical Backend

This project is scaffolded to satisfy the deeprun v1 backend contract.

## Stack

- Node 20+
- TypeScript strict mode
- Fastify + Pino logging
- Prisma + PostgreSQL
- Zod validation
- Vitest tests
- JWT auth

## Commands

- npm install
- npm run prisma:generate
- npm run prisma:migrate
- npm run prisma:seed
- npm run dev
`,
    "package.json": `{
  "name": "deeprun-canonical-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/src/server.js",
    "check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate deploy",
    "prisma:seed": "tsx prisma/seed.ts"
  },
  "dependencies": {
    "@fastify/cors": "^10.0.1",
    "@fastify/helmet": "^13.0.0",
    "@fastify/jwt": "^9.1.0",
    "@fastify/rate-limit": "^10.2.0",
    "@prisma/client": "^6.3.1",
    "dotenv": "^16.4.7",
    "fastify": "^5.2.1",
    "pino": "^9.6.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.13.4",
    "prisma": "^6.3.1",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.5"
  }
}
`,
    "package-lock.json": `{
  "name": "deeprun-canonical-backend",
  "version": "0.1.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "deeprun-canonical-backend",
      "version": "0.1.0",
      "dependencies": {
        "@fastify/cors": "^10.0.1",
        "@fastify/helmet": "^13.0.0",
        "@fastify/jwt": "^9.1.0",
        "@fastify/rate-limit": "^10.2.0",
        "@prisma/client": "^6.3.1",
        "dotenv": "^16.4.7",
        "fastify": "^5.2.1",
        "pino": "^9.6.0",
        "zod": "^3.24.1"
      },
      "devDependencies": {
        "@types/node": "^22.13.4",
        "prisma": "^6.3.1",
        "tsx": "^4.19.3",
        "typescript": "^5.8.2",
        "vitest": "^3.0.5"
      },
      "engines": {
        "node": ">=20.0.0"
      }
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.27.3.tgz",
      "integrity": "sha512-9fJMTNFTWZMh5qwrBItuziu834eOCUcEqymSH7pY+zoMVEZg3gcPuBNxH1EvfVYe9h0x/Ptw8KBzv7qxb7l8dg==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "aix"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.27.3.tgz",
      "integrity": "sha512-i5D1hPY7GIQmXlXhs2w8AWHhenb00+GxjxRncS2ZM7YNVGNfaMxgzSGuO8o8SJzRc/oZwU2bcScvVERk03QhzA==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.27.3.tgz",
      "integrity": "sha512-YdghPYUmj/FX2SYKJ0OZxf+iaKgMsKHVPF1MAq/P8WirnSpCStzKJFjOjzsW0QQ7oIAiccHdcqjbHmJxRb/dmg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.27.3.tgz",
      "integrity": "sha512-IN/0BNTkHtk8lkOM8JWAYFg4ORxBkZQf9zXiEOfERX/CzxW3Vg1ewAhU7QSWQpVIzTW+b8Xy+lGzdYXV6UZObQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.27.3.tgz",
      "integrity": "sha512-Re491k7ByTVRy0t3EKWajdLIr0gz2kKKfzafkth4Q8A5n1xTHrkqZgLLjFEHVD+AXdUGgQMq+Godfq45mGpCKg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.27.3.tgz",
      "integrity": "sha512-vHk/hA7/1AckjGzRqi6wbo+jaShzRowYip6rt6q7VYEDX4LEy1pZfDpdxCBnGtl+A5zq8iXDcyuxwtv3hNtHFg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.27.3.tgz",
      "integrity": "sha512-ipTYM2fjt3kQAYOvo6vcxJx3nBYAzPjgTCk7QEgZG8AUO3ydUhvelmhrbOheMnGOlaSFUoHXB6un+A7q4ygY9w==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.27.3.tgz",
      "integrity": "sha512-dDk0X87T7mI6U3K9VjWtHOXqwAMJBNN2r7bejDsc+j03SEjtD9HrOl8gVFByeM0aJksoUuUVU9TBaZa2rgj0oA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.27.3.tgz",
      "integrity": "sha512-s6nPv2QkSupJwLYyfS+gwdirm0ukyTFNl3KTgZEAiJDd+iHZcbTPPcWCcRYH+WlNbwChgH2QkE9NSlNrMT8Gfw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.27.3.tgz",
      "integrity": "sha512-sZOuFz/xWnZ4KH3YfFrKCf1WyPZHakVzTiqji3WDc0BCl2kBwiJLCXpzLzUBLgmp4veFZdvN5ChW4Eq/8Fc2Fg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ia32": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.27.3.tgz",
      "integrity": "sha512-yGlQYjdxtLdh0a3jHjuwOrxQjOZYD/C9PfdbgJJF3TIZWnm/tMd/RcNiLngiu4iwcBAOezdnSLAwQDPqTmtTYg==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-loong64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.27.3.tgz",
      "integrity": "sha512-WO60Sn8ly3gtzhyjATDgieJNet/KqsDlX5nRC5Y3oTFcS1l0KWba+SEa9Ja1GfDqSF1z6hif/SkpQJbL63cgOA==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-mips64el": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.27.3.tgz",
      "integrity": "sha512-APsymYA6sGcZ4pD6k+UxbDjOFSvPWyZhjaiPyl/f79xKxwTnrn5QUnXR5prvetuaSMsb4jgeHewIDCIWljrSxw==",
      "cpu": [
        "mips64el"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ppc64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.27.3.tgz",
      "integrity": "sha512-eizBnTeBefojtDb9nSh4vvVQ3V9Qf9Df01PfawPcRzJH4gFSgrObw+LveUyDoKU3kxi5+9RJTCWlj4FjYXVPEA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-riscv64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.27.3.tgz",
      "integrity": "sha512-3Emwh0r5wmfm3ssTWRQSyVhbOHvqegUDRd0WhmXKX2mkHJe1SFCMJhagUleMq+Uci34wLSipf8Lagt4LlpRFWQ==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-s390x": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.27.3.tgz",
      "integrity": "sha512-pBHUx9LzXWBc7MFIEEL0yD/ZVtNgLytvx60gES28GcWMqil8ElCYR4kvbV2BDqsHOvVDRrOxGySBM9Fcv744hw==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.27.3.tgz",
      "integrity": "sha512-Czi8yzXUWIQYAtL/2y6vogER8pvcsOsk5cpwL4Gk5nJqH5UZiVByIY8Eorm5R13gq+DQKYg0+JyQoytLQas4dA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.27.3.tgz",
      "integrity": "sha512-sDpk0RgmTCR/5HguIZa9n9u+HVKf40fbEUt+iTzSnCaGvY9kFP0YKBWZtJaraonFnqef5SlJ8/TiPAxzyS+UoA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.27.3.tgz",
      "integrity": "sha512-P14lFKJl/DdaE00LItAukUdZO5iqNH7+PjoBm+fLQjtxfcfFE20Xf5CrLsmZdq5LFFZzb5JMZ9grUwvtVYzjiA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.27.3.tgz",
      "integrity": "sha512-AIcMP77AvirGbRl/UZFTq5hjXK+2wC7qFRGoHSDrZ5v5b8DK/GYpXW3CPRL53NkvDqb9D+alBiC/dV0Fb7eJcw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.27.3.tgz",
      "integrity": "sha512-DnW2sRrBzA+YnE70LKqnM3P+z8vehfJWHXECbwBmH/CU51z6FiqTQTHFenPlHmo3a8UgpLyH3PT+87OViOh1AQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openharmony-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.27.3.tgz",
      "integrity": "sha512-NinAEgr/etERPTsZJ7aEZQvvg/A6IsZG/LgZy+81wON2huV7SrK3e63dU0XhyZP4RKGyTm7aOgmQk0bGp0fy2g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/sunos-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.27.3.tgz",
      "integrity": "sha512-PanZ+nEz+eWoBJ8/f8HKxTTD172SKwdXebZ0ndd953gt1HRBbhMsaNqjTyYLGLPdoWHy4zLU7bDVJztF5f3BHA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "sunos"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-arm64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.27.3.tgz",
      "integrity": "sha512-B2t59lWWYrbRDw/tjiWOuzSsFh1Y/E95ofKz7rIVYSQkUYBjfSgf6oeYPNWHToFRr2zx52JKApIcAS/D5TUBnA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-ia32": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.27.3.tgz",
      "integrity": "sha512-QLKSFeXNS8+tHW7tZpMtjlNb7HKau0QDpwm49u0vUp9y1WOF+PEzkU84y9GqYaAVW8aH8f3GcBck26jh54cX4Q==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-x64": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.27.3.tgz",
      "integrity": "sha512-4uJGhsxuptu3OcpVAzli+/gWusVGwZZHTlS63hh++ehExkVT8SgiEf7/uC/PclrPPkLhZqGgCTjd0VWLo6xMqA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@fastify/ajv-compiler": {
      "version": "4.0.5",
      "resolved": "https://registry.npmjs.org/@fastify/ajv-compiler/-/ajv-compiler-4.0.5.tgz",
      "integrity": "sha512-KoWKW+MhvfTRWL4qrhUwAAZoaChluo0m0vbiJlGMt2GXvL4LVPQEjt8kSpHI3IBq5Rez8fg+XeH3cneztq+C7A==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "ajv": "^8.12.0",
        "ajv-formats": "^3.0.1",
        "fast-uri": "^3.0.0"
      }
    },
    "node_modules/@fastify/cors": {
      "version": "10.1.0",
      "resolved": "https://registry.npmjs.org/@fastify/cors/-/cors-10.1.0.tgz",
      "integrity": "sha512-MZyBCBJtII60CU9Xme/iE4aEy8G7QpzGR8zkdXZkDFt7ElEMachbE61tfhAG/bvSaULlqlf0huMT12T7iqEmdQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "fastify-plugin": "^5.0.0",
        "mnemonist": "0.40.0"
      }
    },
    "node_modules/@fastify/error": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/@fastify/error/-/error-4.2.0.tgz",
      "integrity": "sha512-RSo3sVDXfHskiBZKBPRgnQTtIqpi/7zhJOEmAxCiBcM7d0uwdGdxLlsCaLzGs8v8NnxIRlfG0N51p5yFaOentQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT"
    },
    "node_modules/@fastify/fast-json-stringify-compiler": {
      "version": "5.0.3",
      "resolved": "https://registry.npmjs.org/@fastify/fast-json-stringify-compiler/-/fast-json-stringify-compiler-5.0.3.tgz",
      "integrity": "sha512-uik7yYHkLr6fxd8hJSZ8c+xF4WafPK+XzneQDPU+D10r5X19GW8lJcom2YijX2+qtFF1ENJlHXKFM9ouXNJYgQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "fast-json-stringify": "^6.0.0"
      }
    },
    "node_modules/@fastify/forwarded": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/@fastify/forwarded/-/forwarded-3.0.1.tgz",
      "integrity": "sha512-JqDochHFqXs3C3Ml3gOY58zM7OqO9ENqPo0UqAjAjH8L01fRZqwX9iLeX34//kiJubF7r2ZQHtBRU36vONbLlw==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT"
    },
    "node_modules/@fastify/helmet": {
      "version": "13.0.2",
      "resolved": "https://registry.npmjs.org/@fastify/helmet/-/helmet-13.0.2.tgz",
      "integrity": "sha512-tO1QMkOfNeCt9l4sG/FiWErH4QMm+RjHzbMTrgew1DYOQ2vb/6M1G2iNABBrD7Xq6dUk+HLzWW8u+rmmhQHifA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "fastify-plugin": "^5.0.0",
        "helmet": "^8.0.0"
      }
    },
    "node_modules/@fastify/jwt": {
      "version": "9.1.0",
      "resolved": "https://registry.npmjs.org/@fastify/jwt/-/jwt-9.1.0.tgz",
      "integrity": "sha512-CiGHCnS5cPMdb004c70sUWhQTfzrJHAeTywt7nVw6dAiI0z1o4WRvU94xfijhkaId4bIxTCOjFgn4sU+Gvk43w==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@fastify/error": "^4.0.0",
        "@lukeed/ms": "^2.0.2",
        "fast-jwt": "^5.0.0",
        "fastify-plugin": "^5.0.0",
        "steed": "^1.1.3"
      }
    },
    "node_modules/@fastify/merge-json-schemas": {
      "version": "0.2.1",
      "resolved": "https://registry.npmjs.org/@fastify/merge-json-schemas/-/merge-json-schemas-0.2.1.tgz",
      "integrity": "sha512-OA3KGBCy6KtIvLf8DINC5880o5iBlDX4SxzLQS8HorJAbqluzLRn80UXU0bxZn7UOFhFgpRJDasfwn9nG4FG4A==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "dequal": "^2.0.3"
      }
    },
    "node_modules/@fastify/proxy-addr": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/@fastify/proxy-addr/-/proxy-addr-5.1.0.tgz",
      "integrity": "sha512-INS+6gh91cLUjB+PVHfu1UqcB76Sqtpyp7bnL+FYojhjygvOPA9ctiD/JDKsyD9Xgu4hUhCSJBPig/w7duNajw==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@fastify/forwarded": "^3.0.0",
        "ipaddr.js": "^2.1.0"
      }
    },
    "node_modules/@fastify/rate-limit": {
      "version": "10.3.0",
      "resolved": "https://registry.npmjs.org/@fastify/rate-limit/-/rate-limit-10.3.0.tgz",
      "integrity": "sha512-eIGkG9XKQs0nyynatApA3EVrojHOuq4l6fhB4eeCk4PIOeadvOJz9/4w3vGI44Go17uaXOWEcPkaD8kuKm7g6Q==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@lukeed/ms": "^2.0.2",
        "fastify-plugin": "^5.0.0",
        "toad-cache": "^3.7.0"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.5.5",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.5.5.tgz",
      "integrity": "sha512-cYQ9310grqxueWbl+WuIUIaiUaDcj7WOq5fVhEljNVgRfOUhY9fy2zTvfoqWsnebh8Sl70VScFbICvJnLKB0Og==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@lukeed/ms": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/@lukeed/ms/-/ms-2.0.2.tgz",
      "integrity": "sha512-9I2Zn6+NJLfaGoz9jN3lpwDgAYvfGeNYdbAIjJOqzs4Tpc+VU3Jqq4IofSUBKajiDS8k9fZIg18/z13mpk1bsA==",
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/@pinojs/redact": {
      "version": "0.4.0",
      "resolved": "https://registry.npmjs.org/@pinojs/redact/-/redact-0.4.0.tgz",
      "integrity": "sha512-k2ENnmBugE/rzQfEcdWHcCY+/FM3VLzH9cYEsbdsoqrvzAKRhUZeRNhAZvB8OitQJ1TBed3yqWtdjzS6wJKBwg==",
      "license": "MIT"
    },
    "node_modules/@prisma/client": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/client/-/client-6.19.2.tgz",
      "integrity": "sha512-gR2EMvfK/aTxsuooaDA32D8v+us/8AAet+C3J1cc04SW35FPdZYgLF+iN4NDLUgAaUGTKdAB0CYenu1TAgGdMg==",
      "hasInstallScript": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=18.18"
      },
      "peerDependencies": {
        "prisma": "*",
        "typescript": ">=5.1.0"
      },
      "peerDependenciesMeta": {
        "prisma": {
          "optional": true
        },
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/@prisma/config": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/config/-/config-6.19.2.tgz",
      "integrity": "sha512-kadBGDl+aUswv/zZMk9Mx0C8UZs1kjao8H9/JpI4Wh4SHZaM7zkTwiKn/iFLfRg+XtOAo/Z/c6pAYhijKl0nzQ==",
      "devOptional": true,
      "license": "Apache-2.0",
      "dependencies": {
        "c12": "3.1.0",
        "deepmerge-ts": "7.1.5",
        "effect": "3.18.4",
        "empathic": "2.0.0"
      }
    },
    "node_modules/@prisma/debug": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/debug/-/debug-6.19.2.tgz",
      "integrity": "sha512-lFnEZsLdFLmEVCVNdskLDCL8Uup41GDfU0LUfquw+ercJC8ODTuL0WNKgOKmYxCJVvFwf0OuZBzW99DuWmoH2A==",
      "devOptional": true,
      "license": "Apache-2.0"
    },
    "node_modules/@prisma/engines": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/engines/-/engines-6.19.2.tgz",
      "integrity": "sha512-TTkJ8r+uk/uqczX40wb+ODG0E0icVsMgwCTyTHXehaEfb0uo80M9g1aW1tEJrxmFHeOZFXdI2sTA1j1AgcHi4A==",
      "devOptional": true,
      "hasInstallScript": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@prisma/debug": "6.19.2",
        "@prisma/engines-version": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7",
        "@prisma/fetch-engine": "6.19.2",
        "@prisma/get-platform": "6.19.2"
      }
    },
    "node_modules/@prisma/engines-version": {
      "version": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7",
      "resolved": "https://registry.npmjs.org/@prisma/engines-version/-/engines-version-7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7.tgz",
      "integrity": "sha512-03bgb1VD5gvuumNf+7fVGBzfpJPjmqV423l/WxsWk2cNQ42JD0/SsFBPhN6z8iAvdHs07/7ei77SKu7aZfq8bA==",
      "devOptional": true,
      "license": "Apache-2.0"
    },
    "node_modules/@prisma/fetch-engine": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/fetch-engine/-/fetch-engine-6.19.2.tgz",
      "integrity": "sha512-h4Ff4Pho+SR1S8XerMCC12X//oY2bG3Iug/fUnudfcXEUnIeRiBdXHFdGlGOgQ3HqKgosTEhkZMvGM9tWtYC+Q==",
      "devOptional": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@prisma/debug": "6.19.2",
        "@prisma/engines-version": "7.1.1-3.c2990dca591cba766e3b7ef5d9e8a84796e47ab7",
        "@prisma/get-platform": "6.19.2"
      }
    },
    "node_modules/@prisma/get-platform": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/@prisma/get-platform/-/get-platform-6.19.2.tgz",
      "integrity": "sha512-PGLr06JUSTqIvztJtAzIxOwtWKtJm5WwOG6xpsgD37Rc84FpfUBGLKz65YpJBGtkRQGXTYEFie7pYALocC3MtA==",
      "devOptional": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@prisma/debug": "6.19.2"
      }
    },
    "node_modules/@rollup/rollup-android-arm-eabi": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm-eabi/-/rollup-android-arm-eabi-4.59.0.tgz",
      "integrity": "sha512-upnNBkA6ZH2VKGcBj9Fyl9IGNPULcjXRlg0LLeaioQWueH30p6IXtJEbKAgvyv+mJaMxSm1l6xwDXYjpEMiLMg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-android-arm64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm64/-/rollup-android-arm64-4.59.0.tgz",
      "integrity": "sha512-hZ+Zxj3SySm4A/DylsDKZAeVg0mvi++0PYVceVyX7hemkw7OreKdCvW2oQ3T1FMZvCaQXqOTHb8qmBShoqk69Q==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-darwin-arm64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-arm64/-/rollup-darwin-arm64-4.59.0.tgz",
      "integrity": "sha512-W2Psnbh1J8ZJw0xKAd8zdNgF9HRLkdWwwdWqubSVk0pUuQkoHnv7rx4GiF9rT4t5DIZGAsConRE3AxCdJ4m8rg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-darwin-x64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-x64/-/rollup-darwin-x64-4.59.0.tgz",
      "integrity": "sha512-ZW2KkwlS4lwTv7ZVsYDiARfFCnSGhzYPdiOU4IM2fDbL+QGlyAbjgSFuqNRbSthybLbIJ915UtZBtmuLrQAT/w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-arm64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-arm64/-/rollup-freebsd-arm64-4.59.0.tgz",
      "integrity": "sha512-EsKaJ5ytAu9jI3lonzn3BgG8iRBjV4LxZexygcQbpiU0wU0ATxhNVEpXKfUa0pS05gTcSDMKpn3Sx+QB9RlTTA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-x64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-x64/-/rollup-freebsd-x64-4.59.0.tgz",
      "integrity": "sha512-d3DuZi2KzTMjImrxoHIAODUZYoUUMsuUiY4SRRcJy6NJoZ6iIqWnJu9IScV9jXysyGMVuW+KNzZvBLOcpdl3Vg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-gnueabihf": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-gnueabihf/-/rollup-linux-arm-gnueabihf-4.59.0.tgz",
      "integrity": "sha512-t4ONHboXi/3E0rT6OZl1pKbl2Vgxf9vJfWgmUoCEVQVxhW6Cw/c8I6hbbu7DAvgp82RKiH7TpLwxnJeKv2pbsw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-musleabihf": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-musleabihf/-/rollup-linux-arm-musleabihf-4.59.0.tgz",
      "integrity": "sha512-CikFT7aYPA2ufMD086cVORBYGHffBo4K8MQ4uPS/ZnY54GKj36i196u8U+aDVT2LX4eSMbyHtyOh7D7Zvk2VvA==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-gnu/-/rollup-linux-arm64-gnu-4.59.0.tgz",
      "integrity": "sha512-jYgUGk5aLd1nUb1CtQ8E+t5JhLc9x5WdBKew9ZgAXg7DBk0ZHErLHdXM24rfX+bKrFe+Xp5YuJo54I5HFjGDAA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-musl": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-musl/-/rollup-linux-arm64-musl-4.59.0.tgz",
      "integrity": "sha512-peZRVEdnFWZ5Bh2KeumKG9ty7aCXzzEsHShOZEFiCQlDEepP1dpUl/SrUNXNg13UmZl+gzVDPsiCwnV1uI0RUA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-gnu/-/rollup-linux-loong64-gnu-4.59.0.tgz",
      "integrity": "sha512-gbUSW/97f7+r4gHy3Jlup8zDG190AuodsWnNiXErp9mT90iCy9NKKU0Xwx5k8VlRAIV2uU9CsMnEFg/xXaOfXg==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-musl": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-musl/-/rollup-linux-loong64-musl-4.59.0.tgz",
      "integrity": "sha512-yTRONe79E+o0FWFijasoTjtzG9EBedFXJMl888NBEDCDV9I2wGbFFfJQQe63OijbFCUZqxpHz1GzpbtSFikJ4Q==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-gnu/-/rollup-linux-ppc64-gnu-4.59.0.tgz",
      "integrity": "sha512-sw1o3tfyk12k3OEpRddF68a1unZ5VCN7zoTNtSn2KndUE+ea3m3ROOKRCZxEpmT9nsGnogpFP9x6mnLTCaoLkA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-musl": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-musl/-/rollup-linux-ppc64-musl-4.59.0.tgz",
      "integrity": "sha512-+2kLtQ4xT3AiIxkzFVFXfsmlZiG5FXYW7ZyIIvGA7Bdeuh9Z0aN4hVyXS/G1E9bTP/vqszNIN/pUKCk/BTHsKA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-gnu/-/rollup-linux-riscv64-gnu-4.59.0.tgz",
      "integrity": "sha512-NDYMpsXYJJaj+I7UdwIuHHNxXZ/b/N2hR15NyH3m2qAtb/hHPA4g4SuuvrdxetTdndfj9b1WOmy73kcPRoERUg==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-musl": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-musl/-/rollup-linux-riscv64-musl-4.59.0.tgz",
      "integrity": "sha512-nLckB8WOqHIf1bhymk+oHxvM9D3tyPndZH8i8+35p/1YiVoVswPid2yLzgX7ZJP0KQvnkhM4H6QZ5m0LzbyIAg==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-s390x-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-s390x-gnu/-/rollup-linux-s390x-gnu-4.59.0.tgz",
      "integrity": "sha512-oF87Ie3uAIvORFBpwnCvUzdeYUqi2wY6jRFWJAy1qus/udHFYIkplYRW+wo+GRUP4sKzYdmE1Y3+rY5Gc4ZO+w==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.59.0.tgz",
      "integrity": "sha512-3AHmtQq/ppNuUspKAlvA8HtLybkDflkMuLK4DPo77DfthRb71V84/c4MlWJXixZz4uruIH4uaa07IqoAkG64fg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-musl": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-musl/-/rollup-linux-x64-musl-4.59.0.tgz",
      "integrity": "sha512-2UdiwS/9cTAx7qIUZB/fWtToJwvt0Vbo0zmnYt7ED35KPg13Q0ym1g442THLC7VyI6JfYTP4PiSOWyoMdV2/xg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-openbsd-x64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openbsd-x64/-/rollup-openbsd-x64-4.59.0.tgz",
      "integrity": "sha512-M3bLRAVk6GOwFlPTIxVBSYKUaqfLrn8l0psKinkCFxl4lQvOSz8ZrKDz2gxcBwHFpci0B6rttydI4IpS4IS/jQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ]
    },
    "node_modules/@rollup/rollup-openharmony-arm64": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openharmony-arm64/-/rollup-openharmony-arm64-4.59.0.tgz",
      "integrity": "sha512-tt9KBJqaqp5i5HUZzoafHZX8b5Q2Fe7UjYERADll83O4fGqJ49O1FsL6LpdzVFQcpwvnyd0i+K/VSwu/o/nWlA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ]
    },
    "node_modules/@rollup/rollup-win32-arm64-msvc": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-arm64-msvc/-/rollup-win32-arm64-msvc-4.59.0.tgz",
      "integrity": "sha512-V5B6mG7OrGTwnxaNUzZTDTjDS7F75PO1ae6MJYdiMu60sq0CqN5CVeVsbhPxalupvTX8gXVSU9gq+Rx1/hvu6A==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-ia32-msvc": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-ia32-msvc/-/rollup-win32-ia32-msvc-4.59.0.tgz",
      "integrity": "sha512-UKFMHPuM9R0iBegwzKF4y0C4J9u8C6MEJgFuXTBerMk7EJ92GFVFYBfOZaSGLu6COf7FxpQNqhNS4c4icUPqxA==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-gnu": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-gnu/-/rollup-win32-x64-gnu-4.59.0.tgz",
      "integrity": "sha512-laBkYlSS1n2L8fSo1thDNGrCTQMmxjYY5G0WFWjFFYZkKPjsMBsgJfGf4TLxXrF6RyhI60L8TMOjBMvXiTcxeA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-msvc": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-msvc/-/rollup-win32-x64-msvc-4.59.0.tgz",
      "integrity": "sha512-2HRCml6OztYXyJXAvdDXPKcawukWY2GpR5/nxKp4iBgiO3wcoEGkAaqctIbZcNB6KlUQBIqt8VYkNSj2397EfA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@standard-schema/spec": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/@standard-schema/spec/-/spec-1.1.0.tgz",
      "integrity": "sha512-l2aFy5jALhniG5HgqrD6jXLi/rUWrKvqN/qJx6yoJsgKhblVd+iqqU4RCXavm/jPityDo5TCvKMnpjKnOriy0w==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/@types/chai": {
      "version": "5.2.3",
      "resolved": "https://registry.npmjs.org/@types/chai/-/chai-5.2.3.tgz",
      "integrity": "sha512-Mw558oeA9fFbv65/y4mHtXDs9bPnFMZAL/jxdPFUpOHHIXX91mcgEHbS5Lahr+pwZFR8A7GQleRWeI6cGFC2UA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/deep-eql": "*",
        "assertion-error": "^2.0.1"
      }
    },
    "node_modules/@types/deep-eql": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/@types/deep-eql/-/deep-eql-4.0.2.tgz",
      "integrity": "sha512-c9h9dVVMigMPc4bwTvC5dxqtqJZwQPePsWjPlpSOnojbor6pGqdk541lfA7AqFQr5pB1BRdq0juY9db81BwyFw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/estree": {
      "version": "1.0.8",
      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.8.tgz",
      "integrity": "sha512-dWHzHa2WqEXI/O1E9OjrocMTKJl2mSrEolh1Iomrv6U+JuNwaHXsXx9bLu5gG7BUWFIN0skIQJQ/L1rIex4X6w==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@types/node": {
      "version": "22.19.11",
      "resolved": "https://registry.npmjs.org/@types/node/-/node-22.19.11.tgz",
      "integrity": "sha512-BH7YwL6rA93ReqeQS1c4bsPpcfOmJasG+Fkr6Y59q83f9M1WcBRHR2vM+P9eOisYRcN3ujQoiZY8uk5W+1WL8w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "undici-types": "~6.21.0"
      }
    },
    "node_modules/@vitest/expect": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/expect/-/expect-3.2.4.tgz",
      "integrity": "sha512-Io0yyORnB6sikFlt8QW5K7slY4OjqNX9jmJQ02QDda8lyM6B5oNgVWoSoKPac8/kgnCUzuHQKrSLtu/uOqqrig==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/chai": "^5.2.2",
        "@vitest/spy": "3.2.4",
        "@vitest/utils": "3.2.4",
        "chai": "^5.2.0",
        "tinyrainbow": "^2.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/@vitest/mocker": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/mocker/-/mocker-3.2.4.tgz",
      "integrity": "sha512-46ryTE9RZO/rfDd7pEqFl7etuyzekzEhUbTW3BvmeO/BcCMEgq59BKhek3dXDWgAj4oMK6OZi+vRr1wPW6qjEQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@vitest/spy": "3.2.4",
        "estree-walker": "^3.0.3",
        "magic-string": "^0.30.17"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      },
      "peerDependencies": {
        "msw": "^2.4.9",
        "vite": "^5.0.0 || ^6.0.0 || ^7.0.0-0"
      },
      "peerDependenciesMeta": {
        "msw": {
          "optional": true
        },
        "vite": {
          "optional": true
        }
      }
    },
    "node_modules/@vitest/pretty-format": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/pretty-format/-/pretty-format-3.2.4.tgz",
      "integrity": "sha512-IVNZik8IVRJRTr9fxlitMKeJeXFFFN0JaB9PHPGQ8NKQbGpfjlTx9zO4RefN8gp7eqjNy8nyK3NZmBzOPeIxtA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "tinyrainbow": "^2.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/@vitest/runner": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/runner/-/runner-3.2.4.tgz",
      "integrity": "sha512-oukfKT9Mk41LreEW09vt45f8wx7DordoWUZMYdY/cyAk7w5TWkTRCNZYF7sX7n2wB7jyGAl74OxgwhPgKaqDMQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@vitest/utils": "3.2.4",
        "pathe": "^2.0.3",
        "strip-literal": "^3.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/@vitest/snapshot": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/snapshot/-/snapshot-3.2.4.tgz",
      "integrity": "sha512-dEYtS7qQP2CjU27QBC5oUOxLE/v5eLkGqPE0ZKEIDGMs4vKWe7IjgLOeauHsR0D5YuuycGRO5oSRXnwnmA78fQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@vitest/pretty-format": "3.2.4",
        "magic-string": "^0.30.17",
        "pathe": "^2.0.3"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/@vitest/spy": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/spy/-/spy-3.2.4.tgz",
      "integrity": "sha512-vAfasCOe6AIK70iP5UD11Ac4siNUNJ9i/9PZ3NKx07sG6sUxeag1LWdNrMWeKKYBLlzuK+Gn65Yd5nyL6ds+nw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "tinyspy": "^4.0.3"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/@vitest/utils": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/@vitest/utils/-/utils-3.2.4.tgz",
      "integrity": "sha512-fB2V0JFrQSMsCo9HiSq3Ezpdv4iYaXRG1Sx8edX3MwxfyNn83mKiGzOcH+Fkxt4MHxr3y42fQi1oeAInqgX2QA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@vitest/pretty-format": "3.2.4",
        "loupe": "^3.1.4",
        "tinyrainbow": "^2.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/abstract-logging": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/abstract-logging/-/abstract-logging-2.0.1.tgz",
      "integrity": "sha512-2BjRTZxTPvheOvGbBslFSYOUkr+SjPtOnrLP33f+VIWLzezQpZcqVg7ja3L4dBXmzzgwT+a029jRx5PCi3JuiA==",
      "license": "MIT"
    },
    "node_modules/ajv": {
      "version": "8.18.0",
      "resolved": "https://registry.npmjs.org/ajv/-/ajv-8.18.0.tgz",
      "integrity": "sha512-PlXPeEWMXMZ7sPYOHqmDyCJzcfNrUr3fGNKtezX14ykXOEIvyK81d+qydx89KY5O71FKMPaQ2vBfBFI5NHR63A==",
      "license": "MIT",
      "dependencies": {
        "fast-deep-equal": "^3.1.3",
        "fast-uri": "^3.0.1",
        "json-schema-traverse": "^1.0.0",
        "require-from-string": "^2.0.2"
      },
      "funding": {
        "type": "github",
        "url": "https://github.com/sponsors/epoberezkin"
      }
    },
    "node_modules/ajv-formats": {
      "version": "3.0.1",
      "resolved": "https://registry.npmjs.org/ajv-formats/-/ajv-formats-3.0.1.tgz",
      "integrity": "sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==",
      "license": "MIT",
      "dependencies": {
        "ajv": "^8.0.0"
      },
      "peerDependencies": {
        "ajv": "^8.0.0"
      },
      "peerDependenciesMeta": {
        "ajv": {
          "optional": true
        }
      }
    },
    "node_modules/asn1.js": {
      "version": "5.4.1",
      "resolved": "https://registry.npmjs.org/asn1.js/-/asn1.js-5.4.1.tgz",
      "integrity": "sha512-+I//4cYPccV8LdmBLiX8CYvf9Sp3vQsrqu2QNXRcrbiWvcx/UdlFiqUJJzxRQxgsZmvhXhn4cSKeSmoFjVdupA==",
      "license": "MIT",
      "dependencies": {
        "bn.js": "^4.0.0",
        "inherits": "^2.0.1",
        "minimalistic-assert": "^1.0.0",
        "safer-buffer": "^2.1.0"
      }
    },
    "node_modules/assertion-error": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/assertion-error/-/assertion-error-2.0.1.tgz",
      "integrity": "sha512-Izi8RQcffqCeNVgFigKli1ssklIbpHnCYc6AknXGYoB6grJqyeby7jv12JUQgmTAnIDnbck1uxksT4dzN3PWBA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/atomic-sleep": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/atomic-sleep/-/atomic-sleep-1.0.0.tgz",
      "integrity": "sha512-kNOjDqAh7px0XWNI+4QbzoiR/nTkHAWNud2uvnJquD1/x5a7EQZMJT0AczqK0Qn67oY/TTQ1LbUKajZpp3I9tQ==",
      "license": "MIT",
      "engines": {
        "node": ">=8.0.0"
      }
    },
    "node_modules/avvio": {
      "version": "9.2.0",
      "resolved": "https://registry.npmjs.org/avvio/-/avvio-9.2.0.tgz",
      "integrity": "sha512-2t/sy01ArdHHE0vRH5Hsay+RtCZt3dLPji7W7/MMOCEgze5b7SNDC4j5H6FnVgPkI1MTNFGzHdHrVXDDl7QSSQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@fastify/error": "^4.0.0",
        "fastq": "^1.17.1"
      }
    },
    "node_modules/bn.js": {
      "version": "4.12.3",
      "resolved": "https://registry.npmjs.org/bn.js/-/bn.js-4.12.3.tgz",
      "integrity": "sha512-fGTi3gxV/23FTYdAoUtLYp6qySe2KE3teyZitipKNRuVYcBkoP/bB3guXN/XVKUe9mxCHXnc9C4ocyz8OmgN0g==",
      "license": "MIT"
    },
    "node_modules/c12": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/c12/-/c12-3.1.0.tgz",
      "integrity": "sha512-uWoS8OU1MEIsOv8p/5a82c3H31LsWVR5qiyXVfBNOzfffjUWtPnhAb4BYI2uG2HfGmZmFjCtui5XNWaps+iFuw==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "chokidar": "^4.0.3",
        "confbox": "^0.2.2",
        "defu": "^6.1.4",
        "dotenv": "^16.6.1",
        "exsolve": "^1.0.7",
        "giget": "^2.0.0",
        "jiti": "^2.4.2",
        "ohash": "^2.0.11",
        "pathe": "^2.0.3",
        "perfect-debounce": "^1.0.0",
        "pkg-types": "^2.2.0",
        "rc9": "^2.1.2"
      },
      "peerDependencies": {
        "magicast": "^0.3.5"
      },
      "peerDependenciesMeta": {
        "magicast": {
          "optional": true
        }
      }
    },
    "node_modules/cac": {
      "version": "6.7.14",
      "resolved": "https://registry.npmjs.org/cac/-/cac-6.7.14.tgz",
      "integrity": "sha512-b6Ilus+c3RrdDk+JhLKUAQfzzgLEPy6wcXqS7f/xe1EETvsDP6GORG7SFuOs6cID5YkqchW/LXZbX5bc8j7ZcQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/chai": {
      "version": "5.3.3",
      "resolved": "https://registry.npmjs.org/chai/-/chai-5.3.3.tgz",
      "integrity": "sha512-4zNhdJD/iOjSH0A05ea+Ke6MU5mmpQcbQsSOkgdaUMJ9zTlDTD/GYlwohmIE2u0gaxHYiVHEn1Fw9mZ/ktJWgw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "assertion-error": "^2.0.1",
        "check-error": "^2.1.1",
        "deep-eql": "^5.0.1",
        "loupe": "^3.1.0",
        "pathval": "^2.0.0"
      },
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/check-error": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/check-error/-/check-error-2.1.3.tgz",
      "integrity": "sha512-PAJdDJusoxnwm1VwW07VWwUN1sl7smmC3OKggvndJFadxxDRyFJBX/ggnu/KE4kQAB7a3Dp8f/YXC1FlUprWmA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 16"
      }
    },
    "node_modules/chokidar": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/chokidar/-/chokidar-4.0.3.tgz",
      "integrity": "sha512-Qgzu8kfBvo+cA4962jnP1KkS6Dop5NS6g7R5LFYJr4b8Ub94PPQXUksCw9PvXoeXPRRddRNC5C1JQUR2SMGtnA==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "readdirp": "^4.0.1"
      },
      "engines": {
        "node": ">= 14.16.0"
      },
      "funding": {
        "url": "https://paulmillr.com/funding/"
      }
    },
    "node_modules/citty": {
      "version": "0.1.6",
      "resolved": "https://registry.npmjs.org/citty/-/citty-0.1.6.tgz",
      "integrity": "sha512-tskPPKEs8D2KPafUypv2gxwJP8h/OaJmC82QQGGDQcHvXX43xF2VDACcJVmZ0EuSxkpO9Kc4MlrA3q0+FG58AQ==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "consola": "^3.2.3"
      }
    },
    "node_modules/confbox": {
      "version": "0.2.4",
      "resolved": "https://registry.npmjs.org/confbox/-/confbox-0.2.4.tgz",
      "integrity": "sha512-ysOGlgTFbN2/Y6Cg3Iye8YKulHw+R2fNXHrgSmXISQdMnomY6eNDprVdW9R5xBguEqI954+S6709UyiO7B+6OQ==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/consola": {
      "version": "3.4.2",
      "resolved": "https://registry.npmjs.org/consola/-/consola-3.4.2.tgz",
      "integrity": "sha512-5IKcdX0nnYavi6G7TtOhwkYzyjfJlatbjMjuLSfE2kYT5pMDOilZ4OvMhi637CcDICTmz3wARPoyhqyX1Y+XvA==",
      "devOptional": true,
      "license": "MIT",
      "engines": {
        "node": "^14.18.0 || >=16.10.0"
      }
    },
    "node_modules/cookie": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/cookie/-/cookie-1.1.1.tgz",
      "integrity": "sha512-ei8Aos7ja0weRpFzJnEA9UHJ/7XQmqglbRwnf2ATjcB9Wq874VKH9kfjjirM6UhU2/E5fFYadylyhFldcqSidQ==",
      "license": "MIT",
      "engines": {
        "node": ">=18"
      },
      "funding": {
        "type": "opencollective",
        "url": "https://opencollective.com/express"
      }
    },
    "node_modules/debug": {
      "version": "4.4.3",
      "resolved": "https://registry.npmjs.org/debug/-/debug-4.4.3.tgz",
      "integrity": "sha512-RGwwWnwQvkVfavKVt22FGLw+xYSdzARwm0ru6DhTVA3umU5hZc28V3kO4stgYryrTlLpuvgI9GiijltAjNbcqA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "ms": "^2.1.3"
      },
      "engines": {
        "node": ">=6.0"
      },
      "peerDependenciesMeta": {
        "supports-color": {
          "optional": true
        }
      }
    },
    "node_modules/deep-eql": {
      "version": "5.0.2",
      "resolved": "https://registry.npmjs.org/deep-eql/-/deep-eql-5.0.2.tgz",
      "integrity": "sha512-h5k/5U50IJJFpzfL6nO9jaaumfjO/f2NjK/oYB2Djzm4p9L+3T9qWpZqZ2hAbLPuuYq9wrU08WQyBTL5GbPk5Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/deepmerge-ts": {
      "version": "7.1.5",
      "resolved": "https://registry.npmjs.org/deepmerge-ts/-/deepmerge-ts-7.1.5.tgz",
      "integrity": "sha512-HOJkrhaYsweh+W+e74Yn7YStZOilkoPb6fycpwNLKzSPtruFs48nYis0zy5yJz1+ktUhHxoRDJ27RQAWLIJVJw==",
      "devOptional": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=16.0.0"
      }
    },
    "node_modules/defu": {
      "version": "6.1.4",
      "resolved": "https://registry.npmjs.org/defu/-/defu-6.1.4.tgz",
      "integrity": "sha512-mEQCMmwJu317oSz8CwdIOdwf3xMif1ttiM8LTufzc3g6kR+9Pe236twL8j3IYT1F7GfRgGcW6MWxzZjLIkuHIg==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/dequal": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/dequal/-/dequal-2.0.3.tgz",
      "integrity": "sha512-0je+qPKHEMohvfRTCEo3CrPG6cAzAYgmzKyxRiYSSDkS6eGJdyVJm7WaYA5ECaAD9wLB2T4EEeymA5aFVcYXCA==",
      "license": "MIT",
      "engines": {
        "node": ">=6"
      }
    },
    "node_modules/destr": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/destr/-/destr-2.0.5.tgz",
      "integrity": "sha512-ugFTXCtDZunbzasqBxrK93Ik/DRYsO6S/fedkWEMKqt04xZ4csmnmwGDBAb07QWNaGMAmnTIemsYZCksjATwsA==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/dotenv": {
      "version": "16.6.1",
      "resolved": "https://registry.npmjs.org/dotenv/-/dotenv-16.6.1.tgz",
      "integrity": "sha512-uBq4egWHTcTt33a72vpSG0z3HnPuIl6NqYcTrKEg2azoEyl2hpW0zqlxysq2pK9HlDIHyHyakeYaYnSAwd8bow==",
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://dotenvx.com"
      }
    },
    "node_modules/ecdsa-sig-formatter": {
      "version": "1.0.11",
      "resolved": "https://registry.npmjs.org/ecdsa-sig-formatter/-/ecdsa-sig-formatter-1.0.11.tgz",
      "integrity": "sha512-nagl3RYrbNv6kQkeJIpt6NJZy8twLB/2vtz6yN9Z4vRKHN4/QZJIEbqohALSgwKdnksuY3k5Addp5lg8sVoVcQ==",
      "license": "Apache-2.0",
      "dependencies": {
        "safe-buffer": "^5.0.1"
      }
    },
    "node_modules/effect": {
      "version": "3.18.4",
      "resolved": "https://registry.npmjs.org/effect/-/effect-3.18.4.tgz",
      "integrity": "sha512-b1LXQJLe9D11wfnOKAk3PKxuqYshQ0Heez+y5pnkd3jLj1yx9QhM72zZ9uUrOQyNvrs2GZZd/3maL0ZV18YuDA==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "@standard-schema/spec": "^1.0.0",
        "fast-check": "^3.23.1"
      }
    },
    "node_modules/empathic": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/empathic/-/empathic-2.0.0.tgz",
      "integrity": "sha512-i6UzDscO/XfAcNYD75CfICkmfLedpyPDdozrLMmQc5ORaQcdMoc21OnlEylMIqI7U8eniKrPMxxtj8k0vhmJhA==",
      "devOptional": true,
      "license": "MIT",
      "engines": {
        "node": ">=14"
      }
    },
    "node_modules/es-module-lexer": {
      "version": "1.7.0",
      "resolved": "https://registry.npmjs.org/es-module-lexer/-/es-module-lexer-1.7.0.tgz",
      "integrity": "sha512-jEQoCwk8hyb2AZziIOLhDqpm5+2ww5uIE6lkO/6jcOCusfk6LhMHpXXfBLXTZ7Ydyt0j4VoUQv6uGNYbdW+kBA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/esbuild": {
      "version": "0.27.3",
      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.27.3.tgz",
      "integrity": "sha512-8VwMnyGCONIs6cWue2IdpHxHnAjzxnw2Zr7MkVxB2vjmQ2ivqGFb4LEG3SMnv0Gb2F/G/2yA8zUaiL1gywDCCg==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "esbuild": "bin/esbuild"
      },
      "engines": {
        "node": ">=18"
      },
      "optionalDependencies": {
        "@esbuild/aix-ppc64": "0.27.3",
        "@esbuild/android-arm": "0.27.3",
        "@esbuild/android-arm64": "0.27.3",
        "@esbuild/android-x64": "0.27.3",
        "@esbuild/darwin-arm64": "0.27.3",
        "@esbuild/darwin-x64": "0.27.3",
        "@esbuild/freebsd-arm64": "0.27.3",
        "@esbuild/freebsd-x64": "0.27.3",
        "@esbuild/linux-arm": "0.27.3",
        "@esbuild/linux-arm64": "0.27.3",
        "@esbuild/linux-ia32": "0.27.3",
        "@esbuild/linux-loong64": "0.27.3",
        "@esbuild/linux-mips64el": "0.27.3",
        "@esbuild/linux-ppc64": "0.27.3",
        "@esbuild/linux-riscv64": "0.27.3",
        "@esbuild/linux-s390x": "0.27.3",
        "@esbuild/linux-x64": "0.27.3",
        "@esbuild/netbsd-arm64": "0.27.3",
        "@esbuild/netbsd-x64": "0.27.3",
        "@esbuild/openbsd-arm64": "0.27.3",
        "@esbuild/openbsd-x64": "0.27.3",
        "@esbuild/openharmony-arm64": "0.27.3",
        "@esbuild/sunos-x64": "0.27.3",
        "@esbuild/win32-arm64": "0.27.3",
        "@esbuild/win32-ia32": "0.27.3",
        "@esbuild/win32-x64": "0.27.3"
      }
    },
    "node_modules/estree-walker": {
      "version": "3.0.3",
      "resolved": "https://registry.npmjs.org/estree-walker/-/estree-walker-3.0.3.tgz",
      "integrity": "sha512-7RUKfXgSMMkzt6ZuXmqapOurLGPPfgj6l9uRZ7lRGolvk0y2yocc35LdcxKC5PQZdn2DMqioAQ2NoWcrTKmm6g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/estree": "^1.0.0"
      }
    },
    "node_modules/expect-type": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/expect-type/-/expect-type-1.3.0.tgz",
      "integrity": "sha512-knvyeauYhqjOYvQ66MznSMs83wmHrCycNEN6Ao+2AeYEfxUIkuiVxdEa1qlGEPK+We3n0THiDciYSsCcgW/DoA==",
      "dev": true,
      "license": "Apache-2.0",
      "engines": {
        "node": ">=12.0.0"
      }
    },
    "node_modules/exsolve": {
      "version": "1.0.8",
      "resolved": "https://registry.npmjs.org/exsolve/-/exsolve-1.0.8.tgz",
      "integrity": "sha512-LmDxfWXwcTArk8fUEnOfSZpHOJ6zOMUJKOtFLFqJLoKJetuQG874Uc7/Kki7zFLzYybmZhp1M7+98pfMqeX8yA==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/fast-check": {
      "version": "3.23.2",
      "resolved": "https://registry.npmjs.org/fast-check/-/fast-check-3.23.2.tgz",
      "integrity": "sha512-h5+1OzzfCC3Ef7VbtKdcv7zsstUQwUDlYpUTvjeUsJAssPgLn7QzbboPtL5ro04Mq0rPOsMzl7q5hIbRs2wD1A==",
      "devOptional": true,
      "funding": [
        {
          "type": "individual",
          "url": "https://github.com/sponsors/dubzzz"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fast-check"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "pure-rand": "^6.1.0"
      },
      "engines": {
        "node": ">=8.0.0"
      }
    },
    "node_modules/fast-decode-uri-component": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/fast-decode-uri-component/-/fast-decode-uri-component-1.0.1.tgz",
      "integrity": "sha512-WKgKWg5eUxvRZGwW8FvfbaH7AXSh2cL+3j5fMGzUMCxWBJ3dV3a7Wz8y2f/uQ0e3B6WmodD3oS54jTQ9HVTIIg==",
      "license": "MIT"
    },
    "node_modules/fast-deep-equal": {
      "version": "3.1.3",
      "resolved": "https://registry.npmjs.org/fast-deep-equal/-/fast-deep-equal-3.1.3.tgz",
      "integrity": "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==",
      "license": "MIT"
    },
    "node_modules/fast-json-stringify": {
      "version": "6.3.0",
      "resolved": "https://registry.npmjs.org/fast-json-stringify/-/fast-json-stringify-6.3.0.tgz",
      "integrity": "sha512-oRCntNDY/329HJPlmdNLIdogNtt6Vyjb1WuT01Soss3slIdyUp8kAcDU3saQTOquEK8KFVfwIIF7FebxUAu+yA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@fastify/merge-json-schemas": "^0.2.0",
        "ajv": "^8.12.0",
        "ajv-formats": "^3.0.1",
        "fast-uri": "^3.0.0",
        "json-schema-ref-resolver": "^3.0.0",
        "rfdc": "^1.2.0"
      }
    },
    "node_modules/fast-jwt": {
      "version": "5.0.6",
      "resolved": "https://registry.npmjs.org/fast-jwt/-/fast-jwt-5.0.6.tgz",
      "integrity": "sha512-LPE7OCGUl11q3ZgW681cEU2d0d2JZ37hhJAmetCgNyW8waVaJVZXhyFF6U2so1Iim58Yc7pfxJe2P7MNetQH2g==",
      "license": "Apache-2.0",
      "dependencies": {
        "@lukeed/ms": "^2.0.2",
        "asn1.js": "^5.4.1",
        "ecdsa-sig-formatter": "^1.0.11",
        "mnemonist": "^0.40.0"
      },
      "engines": {
        "node": ">=20"
      }
    },
    "node_modules/fast-querystring": {
      "version": "1.1.2",
      "resolved": "https://registry.npmjs.org/fast-querystring/-/fast-querystring-1.1.2.tgz",
      "integrity": "sha512-g6KuKWmFXc0fID8WWH0jit4g0AGBoJhCkJMb1RmbsSEUNvQ+ZC8D6CUZ+GtF8nMzSPXnhiePyyqqipzNNEnHjg==",
      "license": "MIT",
      "dependencies": {
        "fast-decode-uri-component": "^1.0.1"
      }
    },
    "node_modules/fast-uri": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/fast-uri/-/fast-uri-3.1.0.tgz",
      "integrity": "sha512-iPeeDKJSWf4IEOasVVrknXpaBV0IApz/gp7S2bb7Z4Lljbl2MGJRqInZiUrQwV16cpzw/D3S5j5Julj/gT52AA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "BSD-3-Clause"
    },
    "node_modules/fastfall": {
      "version": "1.5.1",
      "resolved": "https://registry.npmjs.org/fastfall/-/fastfall-1.5.1.tgz",
      "integrity": "sha512-KH6p+Z8AKPXnmA7+Iz2Lh8ARCMr+8WNPVludm1LGkZoD2MjY6LVnRMtTKhkdzI+jr0RzQWXKzKyBJm1zoHEL4Q==",
      "license": "MIT",
      "dependencies": {
        "reusify": "^1.0.0"
      },
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/fastify": {
      "version": "5.7.4",
      "resolved": "https://registry.npmjs.org/fastify/-/fastify-5.7.4.tgz",
      "integrity": "sha512-e6l5NsRdaEP8rdD8VR0ErJASeyaRbzXYpmkrpr2SuvuMq6Si3lvsaVy5C+7gLanEkvjpMDzBXWE5HPeb/hgTxA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "@fastify/ajv-compiler": "^4.0.5",
        "@fastify/error": "^4.0.0",
        "@fastify/fast-json-stringify-compiler": "^5.0.0",
        "@fastify/proxy-addr": "^5.0.0",
        "abstract-logging": "^2.0.1",
        "avvio": "^9.0.0",
        "fast-json-stringify": "^6.0.0",
        "find-my-way": "^9.0.0",
        "light-my-request": "^6.0.0",
        "pino": "^10.1.0",
        "process-warning": "^5.0.0",
        "rfdc": "^1.3.1",
        "secure-json-parse": "^4.0.0",
        "semver": "^7.6.0",
        "toad-cache": "^3.7.0"
      }
    },
    "node_modules/fastify-plugin": {
      "version": "5.1.0",
      "resolved": "https://registry.npmjs.org/fastify-plugin/-/fastify-plugin-5.1.0.tgz",
      "integrity": "sha512-FAIDA8eovSt5qcDgcBvDuX/v0Cjz0ohGhENZ/wpc3y+oZCY2afZ9Baqql3g/lC+OHRnciQol4ww7tuthOb9idw==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT"
    },
    "node_modules/fastify/node_modules/pino": {
      "version": "10.3.1",
      "resolved": "https://registry.npmjs.org/pino/-/pino-10.3.1.tgz",
      "integrity": "sha512-r34yH/GlQpKZbU1BvFFqOjhISRo1MNx1tWYsYvmj6KIRHSPMT2+yHOEb1SG6NMvRoHRF0a07kCOox/9yakl1vg==",
      "license": "MIT",
      "dependencies": {
        "@pinojs/redact": "^0.4.0",
        "atomic-sleep": "^1.0.0",
        "on-exit-leak-free": "^2.1.0",
        "pino-abstract-transport": "^3.0.0",
        "pino-std-serializers": "^7.0.0",
        "process-warning": "^5.0.0",
        "quick-format-unescaped": "^4.0.3",
        "real-require": "^0.2.0",
        "safe-stable-stringify": "^2.3.1",
        "sonic-boom": "^4.0.1",
        "thread-stream": "^4.0.0"
      },
      "bin": {
        "pino": "bin.js"
      }
    },
    "node_modules/fastify/node_modules/pino-abstract-transport": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/pino-abstract-transport/-/pino-abstract-transport-3.0.0.tgz",
      "integrity": "sha512-wlfUczU+n7Hy/Ha5j9a/gZNy7We5+cXp8YL+X+PG8S0KXxw7n/JXA3c46Y0zQznIJ83URJiwy7Lh56WLokNuxg==",
      "license": "MIT",
      "dependencies": {
        "split2": "^4.0.0"
      }
    },
    "node_modules/fastify/node_modules/thread-stream": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/thread-stream/-/thread-stream-4.0.0.tgz",
      "integrity": "sha512-4iMVL6HAINXWf1ZKZjIPcz5wYaOdPhtO8ATvZ+Xqp3BTdaqtAwQkNmKORqcIo5YkQqGXq5cwfswDwMqqQNrpJA==",
      "license": "MIT",
      "dependencies": {
        "real-require": "^0.2.0"
      },
      "engines": {
        "node": ">=20"
      }
    },
    "node_modules/fastparallel": {
      "version": "2.4.1",
      "resolved": "https://registry.npmjs.org/fastparallel/-/fastparallel-2.4.1.tgz",
      "integrity": "sha512-qUmhxPgNHmvRjZKBFUNI0oZuuH9OlSIOXmJ98lhKPxMZZ7zS/Fi0wRHOihDSz0R1YiIOjxzOY4bq65YTcdBi2Q==",
      "license": "ISC",
      "dependencies": {
        "reusify": "^1.0.4",
        "xtend": "^4.0.2"
      }
    },
    "node_modules/fastq": {
      "version": "1.20.1",
      "resolved": "https://registry.npmjs.org/fastq/-/fastq-1.20.1.tgz",
      "integrity": "sha512-GGToxJ/w1x32s/D2EKND7kTil4n8OVk/9mycTc4VDza13lOvpUZTGX3mFSCtV9ksdGBVzvsyAVLM6mHFThxXxw==",
      "license": "ISC",
      "dependencies": {
        "reusify": "^1.0.4"
      }
    },
    "node_modules/fastseries": {
      "version": "1.7.2",
      "resolved": "https://registry.npmjs.org/fastseries/-/fastseries-1.7.2.tgz",
      "integrity": "sha512-dTPFrPGS8SNSzAt7u/CbMKCJ3s01N04s4JFbORHcmyvVfVKmbhMD1VtRbh5enGHxkaQDqWyLefiKOGGmohGDDQ==",
      "license": "ISC",
      "dependencies": {
        "reusify": "^1.0.0",
        "xtend": "^4.0.0"
      }
    },
    "node_modules/fdir": {
      "version": "6.5.0",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.5.0.tgz",
      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12.0.0"
      },
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/find-my-way": {
      "version": "9.5.0",
      "resolved": "https://registry.npmjs.org/find-my-way/-/find-my-way-9.5.0.tgz",
      "integrity": "sha512-VW2RfnmscZO5KgBY5XVyKREMW5nMZcxDy+buTOsL+zIPnBlbKm+00sgzoQzq1EVh4aALZLfKdwv6atBGcjvjrQ==",
      "license": "MIT",
      "dependencies": {
        "fast-deep-equal": "^3.1.3",
        "fast-querystring": "^1.0.0",
        "safe-regex2": "^5.0.0"
      },
      "engines": {
        "node": ">=20"
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/get-tsconfig": {
      "version": "4.13.6",
      "resolved": "https://registry.npmjs.org/get-tsconfig/-/get-tsconfig-4.13.6.tgz",
      "integrity": "sha512-shZT/QMiSHc/YBLxxOkMtgSid5HFoauqCE3/exfsEcwg1WkeqjG+V40yBbBrsD+jW2HDXcs28xOfcbm2jI8Ddw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "resolve-pkg-maps": "^1.0.0"
      },
      "funding": {
        "url": "https://github.com/privatenumber/get-tsconfig?sponsor=1"
      }
    },
    "node_modules/giget": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/giget/-/giget-2.0.0.tgz",
      "integrity": "sha512-L5bGsVkxJbJgdnwyuheIunkGatUF/zssUoxxjACCseZYAVbaqdh9Tsmmlkl8vYan09H7sbvKt4pS8GqKLBrEzA==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "citty": "^0.1.6",
        "consola": "^3.4.0",
        "defu": "^6.1.4",
        "node-fetch-native": "^1.6.6",
        "nypm": "^0.6.0",
        "pathe": "^2.0.3"
      },
      "bin": {
        "giget": "dist/cli.mjs"
      }
    },
    "node_modules/helmet": {
      "version": "8.1.0",
      "resolved": "https://registry.npmjs.org/helmet/-/helmet-8.1.0.tgz",
      "integrity": "sha512-jOiHyAZsmnr8LqoPGmCjYAaiuWwjAPLgY8ZX2XrmHawt99/u1y6RgrZMTeoPfpUbV96HOalYgz1qzkRbw54Pmg==",
      "license": "MIT",
      "engines": {
        "node": ">=18.0.0"
      }
    },
    "node_modules/inherits": {
      "version": "2.0.4",
      "resolved": "https://registry.npmjs.org/inherits/-/inherits-2.0.4.tgz",
      "integrity": "sha512-k/vGaX4/Yla3WzyMCvTQOXYeIHvqOKtnqBduzTHpzpQZzAskKMhZ2K+EnBiSM9zGSoIFeMpXKxa4dYeZIQqewQ==",
      "license": "ISC"
    },
    "node_modules/ipaddr.js": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/ipaddr.js/-/ipaddr.js-2.3.0.tgz",
      "integrity": "sha512-Zv/pA+ciVFbCSBBjGfaKUya/CcGmUHzTydLMaTwrUUEM2DIEO3iZvueGxmacvmN50fGpGVKeTXpb2LcYQxeVdg==",
      "license": "MIT",
      "engines": {
        "node": ">= 10"
      }
    },
    "node_modules/jiti": {
      "version": "2.6.1",
      "resolved": "https://registry.npmjs.org/jiti/-/jiti-2.6.1.tgz",
      "integrity": "sha512-ekilCSN1jwRvIbgeg/57YFh8qQDNbwDb9xT/qu2DAHbFFZUicIl4ygVaAvzveMhMVr3LnpSKTNnwt8PoOfmKhQ==",
      "devOptional": true,
      "license": "MIT",
      "bin": {
        "jiti": "lib/jiti-cli.mjs"
      }
    },
    "node_modules/js-tokens": {
      "version": "9.0.1",
      "resolved": "https://registry.npmjs.org/js-tokens/-/js-tokens-9.0.1.tgz",
      "integrity": "sha512-mxa9E9ITFOt0ban3j6L5MpjwegGz6lBQmM1IJkWeBZGcMxto50+eWdjC/52xDbS2vy0k7vIMK0Fe2wfL9OQSpQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/json-schema-ref-resolver": {
      "version": "3.0.0",
      "resolved": "https://registry.npmjs.org/json-schema-ref-resolver/-/json-schema-ref-resolver-3.0.0.tgz",
      "integrity": "sha512-hOrZIVL5jyYFjzk7+y7n5JDzGlU8rfWDuYyHwGa2WA8/pcmMHezp2xsVwxrebD/Q9t8Nc5DboieySDpCp4WG4A==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "dequal": "^2.0.3"
      }
    },
    "node_modules/json-schema-traverse": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/json-schema-traverse/-/json-schema-traverse-1.0.0.tgz",
      "integrity": "sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==",
      "license": "MIT"
    },
    "node_modules/light-my-request": {
      "version": "6.6.0",
      "resolved": "https://registry.npmjs.org/light-my-request/-/light-my-request-6.6.0.tgz",
      "integrity": "sha512-CHYbu8RtboSIoVsHZ6Ye4cj4Aw/yg2oAFimlF7mNvfDV192LR7nDiKtSIfCuLT7KokPSTn/9kfVLm5OGN0A28A==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "BSD-3-Clause",
      "dependencies": {
        "cookie": "^1.0.1",
        "process-warning": "^4.0.0",
        "set-cookie-parser": "^2.6.0"
      }
    },
    "node_modules/light-my-request/node_modules/process-warning": {
      "version": "4.0.1",
      "resolved": "https://registry.npmjs.org/process-warning/-/process-warning-4.0.1.tgz",
      "integrity": "sha512-3c2LzQ3rY9d0hc1emcsHhfT9Jwz0cChib/QN89oME2R451w5fy3f0afAhERFZAwrbDU43wk12d0ORBpDVME50Q==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT"
    },
    "node_modules/loupe": {
      "version": "3.2.1",
      "resolved": "https://registry.npmjs.org/loupe/-/loupe-3.2.1.tgz",
      "integrity": "sha512-CdzqowRJCeLU72bHvWqwRBBlLcMEtIvGrlvef74kMnV2AolS9Y8xUv1I0U/MNAWMhBlKIoyuEgoJ0t/bbwHbLQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/magic-string": {
      "version": "0.30.21",
      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.21.tgz",
      "integrity": "sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.5"
      }
    },
    "node_modules/minimalistic-assert": {
      "version": "1.0.1",
      "resolved": "https://registry.npmjs.org/minimalistic-assert/-/minimalistic-assert-1.0.1.tgz",
      "integrity": "sha512-UtJcAD4yEaGtjPezWuO9wC4nwUnVH/8/Im3yEHQP4b67cXlD/Qr9hdITCU1xDbSEXg2XKNaP8jsReV7vQd00/A==",
      "license": "ISC"
    },
    "node_modules/mnemonist": {
      "version": "0.40.0",
      "resolved": "https://registry.npmjs.org/mnemonist/-/mnemonist-0.40.0.tgz",
      "integrity": "sha512-kdd8AFNig2AD5Rkih7EPCXhu/iMvwevQFX/uEiGhZyPZi7fHqOoF4V4kHLpCfysxXMgQ4B52kdPMCwARshKvEg==",
      "license": "MIT",
      "dependencies": {
        "obliterator": "^2.0.4"
      }
    },
    "node_modules/ms": {
      "version": "2.1.3",
      "resolved": "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz",
      "integrity": "sha512-6FlzubTLZG3J2a/NVCAleEhjzq5oxgHyaCU9yYXvcLsvoVaHJq/s5xXI6/XXP6tz7R9xAOtHnSO/tXtF3WRTlA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/nanoid": {
      "version": "3.3.11",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.11.tgz",
      "integrity": "sha512-N8SpfPUnUp1bK+PMYW8qSWdl9U+wwNWI4QKxOYDy9JAro3WMX7p2OeVRF9v+347pnakNevPmiHhNmZ2HbFA76w==",
      "dev": true,
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/node-fetch-native": {
      "version": "1.6.7",
      "resolved": "https://registry.npmjs.org/node-fetch-native/-/node-fetch-native-1.6.7.tgz",
      "integrity": "sha512-g9yhqoedzIUm0nTnTqAQvueMPVOuIY16bqgAJJC8XOOubYFNwz6IER9qs0Gq2Xd0+CecCKFjtdDTMA4u4xG06Q==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/nypm": {
      "version": "0.6.5",
      "resolved": "https://registry.npmjs.org/nypm/-/nypm-0.6.5.tgz",
      "integrity": "sha512-K6AJy1GMVyfyMXRVB88700BJqNUkByijGJM8kEHpLdcAt+vSQAVfkWWHYzuRXHSY6xA2sNc5RjTj0p9rE2izVQ==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "citty": "^0.2.0",
        "pathe": "^2.0.3",
        "tinyexec": "^1.0.2"
      },
      "bin": {
        "nypm": "dist/cli.mjs"
      },
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/nypm/node_modules/citty": {
      "version": "0.2.1",
      "resolved": "https://registry.npmjs.org/citty/-/citty-0.2.1.tgz",
      "integrity": "sha512-kEV95lFBhQgtogAPlQfJJ0WGVSokvLr/UEoFPiKKOXF7pl98HfUVUD0ejsuTCld/9xH9vogSywZ5KqHzXrZpqg==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/obliterator": {
      "version": "2.0.5",
      "resolved": "https://registry.npmjs.org/obliterator/-/obliterator-2.0.5.tgz",
      "integrity": "sha512-42CPE9AhahZRsMNslczq0ctAEtqk8Eka26QofnqC346BZdHDySk3LWka23LI7ULIw11NmltpiLagIq8gBozxTw==",
      "license": "MIT"
    },
    "node_modules/ohash": {
      "version": "2.0.11",
      "resolved": "https://registry.npmjs.org/ohash/-/ohash-2.0.11.tgz",
      "integrity": "sha512-RdR9FQrFwNBNXAr4GixM8YaRZRJ5PUWbKYbE5eOsrwAjJW0q2REGcf79oYPsLyskQCZG1PLN+S/K1V00joZAoQ==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/on-exit-leak-free": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/on-exit-leak-free/-/on-exit-leak-free-2.1.2.tgz",
      "integrity": "sha512-0eJJY6hXLGf1udHwfNftBqH+g73EU4B504nZeKpz1sYRKafAghwxEJunB2O7rDZkL4PGfsMVnTXZ2EjibbqcsA==",
      "license": "MIT",
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/pathe": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/pathe/-/pathe-2.0.3.tgz",
      "integrity": "sha512-WUjGcAqP1gQacoQe+OBJsFA7Ld4DyXuUIjZ5cc75cLHvJ7dtNsTugphxIADwspS+AraAUePCKrSVtPLFj/F88w==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/pathval": {
      "version": "2.0.1",
      "resolved": "https://registry.npmjs.org/pathval/-/pathval-2.0.1.tgz",
      "integrity": "sha512-//nshmD55c46FuFw26xV/xFAaB5HF9Xdap7HJBBnrKdAd6/GxDBaNA1870O79+9ueg61cZLSVc+OaFlfmObYVQ==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">= 14.16"
      }
    },
    "node_modules/perfect-debounce": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/perfect-debounce/-/perfect-debounce-1.0.0.tgz",
      "integrity": "sha512-xCy9V055GLEqoFaHoC1SoLIaLmWctgCUaBaWxDZ7/Zx4CTyX7cJQLJOok/orfjZAh9kEYpjJa4d0KcJmCbctZA==",
      "devOptional": true,
      "license": "MIT"
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "4.0.3",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.3.tgz",
      "integrity": "sha512-5gTmgEY/sqK6gFXLIsQNH19lWb4ebPDLA4SdLP7dsWkIXHWlG66oPuVvXSGFPppYZz8ZDZq0dYYrbHfBCVUb1Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/pino": {
      "version": "9.14.0",
      "resolved": "https://registry.npmjs.org/pino/-/pino-9.14.0.tgz",
      "integrity": "sha512-8OEwKp5juEvb/MjpIc4hjqfgCNysrS94RIOMXYvpYCdm/jglrKEiAYmiumbmGhCvs+IcInsphYDFwqrjr7398w==",
      "license": "MIT",
      "dependencies": {
        "@pinojs/redact": "^0.4.0",
        "atomic-sleep": "^1.0.0",
        "on-exit-leak-free": "^2.1.0",
        "pino-abstract-transport": "^2.0.0",
        "pino-std-serializers": "^7.0.0",
        "process-warning": "^5.0.0",
        "quick-format-unescaped": "^4.0.3",
        "real-require": "^0.2.0",
        "safe-stable-stringify": "^2.3.1",
        "sonic-boom": "^4.0.1",
        "thread-stream": "^3.0.0"
      },
      "bin": {
        "pino": "bin.js"
      }
    },
    "node_modules/pino-abstract-transport": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/pino-abstract-transport/-/pino-abstract-transport-2.0.0.tgz",
      "integrity": "sha512-F63x5tizV6WCh4R6RHyi2Ml+M70DNRXt/+HANowMflpgGFMAym/VKm6G7ZOQRjqN7XbGxK1Lg9t6ZrtzOaivMw==",
      "license": "MIT",
      "dependencies": {
        "split2": "^4.0.0"
      }
    },
    "node_modules/pino-std-serializers": {
      "version": "7.1.0",
      "resolved": "https://registry.npmjs.org/pino-std-serializers/-/pino-std-serializers-7.1.0.tgz",
      "integrity": "sha512-BndPH67/JxGExRgiX1dX0w1FvZck5Wa4aal9198SrRhZjH3GxKQUKIBnYJTdj2HDN3UQAS06HlfcSbQj2OHmaw==",
      "license": "MIT"
    },
    "node_modules/pkg-types": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/pkg-types/-/pkg-types-2.3.0.tgz",
      "integrity": "sha512-SIqCzDRg0s9npO5XQ3tNZioRY1uK06lA41ynBC1YmFTmnY6FjUjVt6s4LoADmwoig1qqD0oK8h1p/8mlMx8Oig==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "confbox": "^0.2.2",
        "exsolve": "^1.0.7",
        "pathe": "^2.0.3"
      }
    },
    "node_modules/postcss": {
      "version": "8.5.6",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.6.tgz",
      "integrity": "sha512-3Ybi1tAuwAP9s0r1UQ2J4n5Y0G05bJkpUIO0/bI9MhwmD70S5aTWbXGBwxHrelT+XM1k6dM0pk+SwNkpTRN7Pg==",
      "dev": true,
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.11",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.1"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/prisma": {
      "version": "6.19.2",
      "resolved": "https://registry.npmjs.org/prisma/-/prisma-6.19.2.tgz",
      "integrity": "sha512-XTKeKxtQElcq3U9/jHyxSPgiRgeYDKxWTPOf6NkXA0dNj5j40MfEsZkMbyNpwDWCUv7YBFUl7I2VK/6ALbmhEg==",
      "devOptional": true,
      "hasInstallScript": true,
      "license": "Apache-2.0",
      "dependencies": {
        "@prisma/config": "6.19.2",
        "@prisma/engines": "6.19.2"
      },
      "bin": {
        "prisma": "build/index.js"
      },
      "engines": {
        "node": ">=18.18"
      },
      "peerDependencies": {
        "typescript": ">=5.1.0"
      },
      "peerDependenciesMeta": {
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/process-warning": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/process-warning/-/process-warning-5.0.0.tgz",
      "integrity": "sha512-a39t9ApHNx2L4+HBnQKqxxHNs1r7KF+Intd8Q/g1bUh6q0WIp9voPXJ/x0j+ZL45KF1pJd9+q2jLIRMfvEshkA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT"
    },
    "node_modules/pure-rand": {
      "version": "6.1.0",
      "resolved": "https://registry.npmjs.org/pure-rand/-/pure-rand-6.1.0.tgz",
      "integrity": "sha512-bVWawvoZoBYpp6yIoQtQXHZjmz35RSVHnUOTefl8Vcjr8snTPY1wnpSPMWekcFwbxI6gtmT7rSYPFvz71ldiOA==",
      "devOptional": true,
      "funding": [
        {
          "type": "individual",
          "url": "https://github.com/sponsors/dubzzz"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fast-check"
        }
      ],
      "license": "MIT"
    },
    "node_modules/quick-format-unescaped": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/quick-format-unescaped/-/quick-format-unescaped-4.0.4.tgz",
      "integrity": "sha512-tYC1Q1hgyRuHgloV/YXs2w15unPVh8qfu/qCTfhTYamaw7fyhumKa2yGpdSo87vY32rIclj+4fWYQXUMs9EHvg==",
      "license": "MIT"
    },
    "node_modules/rc9": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/rc9/-/rc9-2.1.2.tgz",
      "integrity": "sha512-btXCnMmRIBINM2LDZoEmOogIZU7Qe7zn4BpomSKZ/ykbLObuBdvG+mFq11DL6fjH1DRwHhrlgtYWG96bJiC7Cg==",
      "devOptional": true,
      "license": "MIT",
      "dependencies": {
        "defu": "^6.1.4",
        "destr": "^2.0.3"
      }
    },
    "node_modules/readdirp": {
      "version": "4.1.2",
      "resolved": "https://registry.npmjs.org/readdirp/-/readdirp-4.1.2.tgz",
      "integrity": "sha512-GDhwkLfywWL2s6vEjyhri+eXmfH6j1L7JE27WhqLeYzoh/A3DBaYGEj2H/HFZCn/kMfim73FXxEJTw06WtxQwg==",
      "devOptional": true,
      "license": "MIT",
      "engines": {
        "node": ">= 14.18.0"
      },
      "funding": {
        "type": "individual",
        "url": "https://paulmillr.com/funding/"
      }
    },
    "node_modules/real-require": {
      "version": "0.2.0",
      "resolved": "https://registry.npmjs.org/real-require/-/real-require-0.2.0.tgz",
      "integrity": "sha512-57frrGM/OCTLqLOAh0mhVA9VBMHd+9U7Zb2THMGdBUoZVOtGbJzjxsYGDJ3A9AYYCP4hn6y1TVbaOfzWtm5GFg==",
      "license": "MIT",
      "engines": {
        "node": ">= 12.13.0"
      }
    },
    "node_modules/require-from-string": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/require-from-string/-/require-from-string-2.0.2.tgz",
      "integrity": "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==",
      "license": "MIT",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/resolve-pkg-maps": {
      "version": "1.0.0",
      "resolved": "https://registry.npmjs.org/resolve-pkg-maps/-/resolve-pkg-maps-1.0.0.tgz",
      "integrity": "sha512-seS2Tj26TBVOC2NIc2rOe2y2ZO7efxITtLZcGSOnHHNOQ7CkiUBfw0Iw2ck6xkIhPwLhKNLS8BO+hEpngQlqzw==",
      "dev": true,
      "license": "MIT",
      "funding": {
        "url": "https://github.com/privatenumber/resolve-pkg-maps?sponsor=1"
      }
    },
    "node_modules/ret": {
      "version": "0.5.0",
      "resolved": "https://registry.npmjs.org/ret/-/ret-0.5.0.tgz",
      "integrity": "sha512-I1XxrZSQ+oErkRR4jYbAyEEu2I0avBvvMM5JN+6EBprOGRCs63ENqZ3vjavq8fBw2+62G5LF5XelKwuJpcvcxw==",
      "license": "MIT",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/reusify": {
      "version": "1.1.0",
      "resolved": "https://registry.npmjs.org/reusify/-/reusify-1.1.0.tgz",
      "integrity": "sha512-g6QUff04oZpHs0eG5p83rFLhHeV00ug/Yf9nZM6fLeUrPguBTkTQOdpAWWspMh55TZfVQDPaN3NQJfbVRAxdIw==",
      "license": "MIT",
      "engines": {
        "iojs": ">=1.0.0",
        "node": ">=0.10.0"
      }
    },
    "node_modules/rfdc": {
      "version": "1.4.1",
      "resolved": "https://registry.npmjs.org/rfdc/-/rfdc-1.4.1.tgz",
      "integrity": "sha512-q1b3N5QkRUWUl7iyylaaj3kOpIT0N2i9MqIEQXP73GVsN9cw3fdx8X63cEmWhJGi2PPCF23Ijp7ktmd39rawIA==",
      "license": "MIT"
    },
    "node_modules/rollup": {
      "version": "4.59.0",
      "resolved": "https://registry.npmjs.org/rollup/-/rollup-4.59.0.tgz",
      "integrity": "sha512-2oMpl67a3zCH9H79LeMcbDhXW/UmWG/y2zuqnF2jQq5uq9TbM9TVyXvA4+t+ne2IIkBdrLpAaRQAvo7YI/Yyeg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/estree": "1.0.8"
      },
      "bin": {
        "rollup": "dist/bin/rollup"
      },
      "engines": {
        "node": ">=18.0.0",
        "npm": ">=8.0.0"
      },
      "optionalDependencies": {
        "@rollup/rollup-android-arm-eabi": "4.59.0",
        "@rollup/rollup-android-arm64": "4.59.0",
        "@rollup/rollup-darwin-arm64": "4.59.0",
        "@rollup/rollup-darwin-x64": "4.59.0",
        "@rollup/rollup-freebsd-arm64": "4.59.0",
        "@rollup/rollup-freebsd-x64": "4.59.0",
        "@rollup/rollup-linux-arm-gnueabihf": "4.59.0",
        "@rollup/rollup-linux-arm-musleabihf": "4.59.0",
        "@rollup/rollup-linux-arm64-gnu": "4.59.0",
        "@rollup/rollup-linux-arm64-musl": "4.59.0",
        "@rollup/rollup-linux-loong64-gnu": "4.59.0",
        "@rollup/rollup-linux-loong64-musl": "4.59.0",
        "@rollup/rollup-linux-ppc64-gnu": "4.59.0",
        "@rollup/rollup-linux-ppc64-musl": "4.59.0",
        "@rollup/rollup-linux-riscv64-gnu": "4.59.0",
        "@rollup/rollup-linux-riscv64-musl": "4.59.0",
        "@rollup/rollup-linux-s390x-gnu": "4.59.0",
        "@rollup/rollup-linux-x64-gnu": "4.59.0",
        "@rollup/rollup-linux-x64-musl": "4.59.0",
        "@rollup/rollup-openbsd-x64": "4.59.0",
        "@rollup/rollup-openharmony-arm64": "4.59.0",
        "@rollup/rollup-win32-arm64-msvc": "4.59.0",
        "@rollup/rollup-win32-ia32-msvc": "4.59.0",
        "@rollup/rollup-win32-x64-gnu": "4.59.0",
        "@rollup/rollup-win32-x64-msvc": "4.59.0",
        "fsevents": "~2.3.2"
      }
    },
    "node_modules/safe-buffer": {
      "version": "5.2.1",
      "resolved": "https://registry.npmjs.org/safe-buffer/-/safe-buffer-5.2.1.tgz",
      "integrity": "sha512-rp3So07KcdmmKbGvgaNxQSJr7bGVSVk5S9Eq1F+ppbRo70+YeaDxkw5Dd8NPN+GD6bjnYm2VuPuCXmpuYvmCXQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/feross"
        },
        {
          "type": "patreon",
          "url": "https://www.patreon.com/feross"
        },
        {
          "type": "consulting",
          "url": "https://feross.org/support"
        }
      ],
      "license": "MIT"
    },
    "node_modules/safe-regex2": {
      "version": "5.0.0",
      "resolved": "https://registry.npmjs.org/safe-regex2/-/safe-regex2-5.0.0.tgz",
      "integrity": "sha512-YwJwe5a51WlK7KbOJREPdjNrpViQBI3p4T50lfwPuDhZnE3XGVTlGvi+aolc5+RvxDD6bnUmjVsU9n1eboLUYw==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "ret": "~0.5.0"
      }
    },
    "node_modules/safe-stable-stringify": {
      "version": "2.5.0",
      "resolved": "https://registry.npmjs.org/safe-stable-stringify/-/safe-stable-stringify-2.5.0.tgz",
      "integrity": "sha512-b3rppTKm9T+PsVCBEOUR46GWI7fdOs00VKZ1+9c1EWDaDMvjQc6tUwuFyIprgGgTcWoVHSKrU8H31ZHA2e0RHA==",
      "license": "MIT",
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/safer-buffer": {
      "version": "2.1.2",
      "resolved": "https://registry.npmjs.org/safer-buffer/-/safer-buffer-2.1.2.tgz",
      "integrity": "sha512-YZo3K82SD7Riyi0E1EQPojLz7kpepnSQI9IyPbHHg1XXXevb5dJI7tpyN2ADxGcQbHG7vcyRHk0cbwqcQriUtg==",
      "license": "MIT"
    },
    "node_modules/secure-json-parse": {
      "version": "4.1.0",
      "resolved": "https://registry.npmjs.org/secure-json-parse/-/secure-json-parse-4.1.0.tgz",
      "integrity": "sha512-l4KnYfEyqYJxDwlNVyRfO2E4NTHfMKAWdUuA8J0yve2Dz/E/PdBepY03RvyJpssIpRFwJoCD55wA+mEDs6ByWA==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/fastify"
        },
        {
          "type": "opencollective",
          "url": "https://opencollective.com/fastify"
        }
      ],
      "license": "BSD-3-Clause"
    },
    "node_modules/semver": {
      "version": "7.7.4",
      "resolved": "https://registry.npmjs.org/semver/-/semver-7.7.4.tgz",
      "integrity": "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==",
      "license": "ISC",
      "bin": {
        "semver": "bin/semver.js"
      },
      "engines": {
        "node": ">=10"
      }
    },
    "node_modules/set-cookie-parser": {
      "version": "2.7.2",
      "resolved": "https://registry.npmjs.org/set-cookie-parser/-/set-cookie-parser-2.7.2.tgz",
      "integrity": "sha512-oeM1lpU/UvhTxw+g3cIfxXHyJRc/uidd3yK1P242gzHds0udQBYzs3y8j4gCCW+ZJ7ad0yctld8RYO+bdurlvw==",
      "license": "MIT"
    },
    "node_modules/siginfo": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/siginfo/-/siginfo-2.0.0.tgz",
      "integrity": "sha512-ybx0WO1/8bSBLEWXZvEd7gMW3Sn3JFlW3TvX1nREbDLRNQNaeNN8WK0meBwPdAaOI7TtRRRJn/Es1zhrrCHu7g==",
      "dev": true,
      "license": "ISC"
    },
    "node_modules/sonic-boom": {
      "version": "4.2.1",
      "resolved": "https://registry.npmjs.org/sonic-boom/-/sonic-boom-4.2.1.tgz",
      "integrity": "sha512-w6AxtubXa2wTXAUsZMMWERrsIRAdrK0Sc+FUytWvYAhBJLyuI4llrMIC1DtlNSdI99EI86KZum2MMq3EAZlF9Q==",
      "license": "MIT",
      "dependencies": {
        "atomic-sleep": "^1.0.0"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.1",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.1.tgz",
      "integrity": "sha512-UXWMKhLOwVKb728IUtQPXxfYU+usdybtUrK/8uGE8CQMvrhOpwvzDBwj0QhSL7MQc7vIsISBG8VQ8+IDQxpfQA==",
      "dev": true,
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/split2": {
      "version": "4.2.0",
      "resolved": "https://registry.npmjs.org/split2/-/split2-4.2.0.tgz",
      "integrity": "sha512-UcjcJOWknrNkF6PLX83qcHM6KHgVKNkV62Y8a5uYDVv9ydGQVwAHMKqHdJje1VTWpljG0WYpCDhrCdAOYH4TWg==",
      "license": "ISC",
      "engines": {
        "node": ">= 10.x"
      }
    },
    "node_modules/stackback": {
      "version": "0.0.2",
      "resolved": "https://registry.npmjs.org/stackback/-/stackback-0.0.2.tgz",
      "integrity": "sha512-1XMJE5fQo1jGH6Y/7ebnwPOBEkIEnT4QF32d5R1+VXdXveM0IBMJt8zfaxX1P3QhVwrYe+576+jkANtSS2mBbw==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/std-env": {
      "version": "3.10.0",
      "resolved": "https://registry.npmjs.org/std-env/-/std-env-3.10.0.tgz",
      "integrity": "sha512-5GS12FdOZNliM5mAOxFRg7Ir0pWz8MdpYm6AY6VPkGpbA7ZzmbzNcBJQ0GPvvyWgcY7QAhCgf9Uy89I03faLkg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/steed": {
      "version": "1.1.3",
      "resolved": "https://registry.npmjs.org/steed/-/steed-1.1.3.tgz",
      "integrity": "sha512-EUkci0FAUiE4IvGTSKcDJIQ/eRUP2JJb56+fvZ4sdnguLTqIdKjSxUe138poW8mkvKWXW2sFPrgTsxqoISnmoA==",
      "license": "MIT",
      "dependencies": {
        "fastfall": "^1.5.0",
        "fastparallel": "^2.2.0",
        "fastq": "^1.3.0",
        "fastseries": "^1.7.0",
        "reusify": "^1.0.0"
      }
    },
    "node_modules/strip-literal": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/strip-literal/-/strip-literal-3.1.0.tgz",
      "integrity": "sha512-8r3mkIM/2+PpjHoOtiAW8Rg3jJLHaV7xPwG+YRGrv6FP0wwk/toTpATxWYOW0BKdWwl82VT2tFYi5DlROa0Mxg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "js-tokens": "^9.0.1"
      },
      "funding": {
        "url": "https://github.com/sponsors/antfu"
      }
    },
    "node_modules/thread-stream": {
      "version": "3.1.0",
      "resolved": "https://registry.npmjs.org/thread-stream/-/thread-stream-3.1.0.tgz",
      "integrity": "sha512-OqyPZ9u96VohAyMfJykzmivOrY2wfMSf3C5TtFJVgN+Hm6aj+voFhlK+kZEIv2FBh1X6Xp3DlnCOfEQ3B2J86A==",
      "license": "MIT",
      "dependencies": {
        "real-require": "^0.2.0"
      }
    },
    "node_modules/tinybench": {
      "version": "2.9.0",
      "resolved": "https://registry.npmjs.org/tinybench/-/tinybench-2.9.0.tgz",
      "integrity": "sha512-0+DUvqWMValLmha6lr4kD8iAMK1HzV0/aKnCtWb9v9641TnP/MFb7Pc2bxoxQjTXAErryXVgUOfv2YqNllqGeg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/tinyexec": {
      "version": "1.0.2",
      "resolved": "https://registry.npmjs.org/tinyexec/-/tinyexec-1.0.2.tgz",
      "integrity": "sha512-W/KYk+NFhkmsYpuHq5JykngiOCnxeVL8v8dFnqxSD8qEEdRfXk1SDM6JzNqcERbcGYj9tMrDQBYV9cjgnunFIg==",
      "devOptional": true,
      "license": "MIT",
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.15",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.15.tgz",
      "integrity": "sha512-j2Zq4NyQYG5XMST4cbs02Ak8iJUdxRM0XI5QyxXuZOzKOINmWurp3smXu3y5wDcJrptwpSjgXHzIQxR0omXljQ==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.3"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/tinypool": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/tinypool/-/tinypool-1.1.1.tgz",
      "integrity": "sha512-Zba82s87IFq9A9XmjiX5uZA/ARWDrB03OHlq+Vw1fSdt0I+4/Kutwy8BP4Y/y/aORMo61FQ0vIb5j44vSo5Pkg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.0.0 || >=20.0.0"
      }
    },
    "node_modules/tinyrainbow": {
      "version": "2.0.0",
      "resolved": "https://registry.npmjs.org/tinyrainbow/-/tinyrainbow-2.0.0.tgz",
      "integrity": "sha512-op4nsTR47R6p0vMUUoYl/a+ljLFVtlfaXkLQmqfLR1qHma1h/ysYk4hEXZ880bf2CYgTskvTa/e196Vd5dDQXw==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/tinyspy": {
      "version": "4.0.4",
      "resolved": "https://registry.npmjs.org/tinyspy/-/tinyspy-4.0.4.tgz",
      "integrity": "sha512-azl+t0z7pw/z958Gy9svOTuzqIk6xq+NSheJzn5MMWtWTFywIacg2wUlzKFGtt3cthx0r2SxMK0yzJOR0IES7Q==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=14.0.0"
      }
    },
    "node_modules/toad-cache": {
      "version": "3.7.0",
      "resolved": "https://registry.npmjs.org/toad-cache/-/toad-cache-3.7.0.tgz",
      "integrity": "sha512-/m8M+2BJUpoJdgAHoG+baCwBT+tf2VraSfkBgl0Y00qIWt41DJ8R5B8nsEw0I58YwF5IZH6z24/2TobDKnqSWw==",
      "license": "MIT",
      "engines": {
        "node": ">=12"
      }
    },
    "node_modules/tsx": {
      "version": "4.21.0",
      "resolved": "https://registry.npmjs.org/tsx/-/tsx-4.21.0.tgz",
      "integrity": "sha512-5C1sg4USs1lfG0GFb2RLXsdpXqBSEhAaA/0kPL01wxzpMqLILNxIxIOKiILz+cdg/pLnOUxFYOR5yhHU666wbw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "esbuild": "~0.27.0",
        "get-tsconfig": "^4.7.5"
      },
      "bin": {
        "tsx": "dist/cli.mjs"
      },
      "engines": {
        "node": ">=18.0.0"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      }
    },
    "node_modules/typescript": {
      "version": "5.9.3",
      "resolved": "https://registry.npmjs.org/typescript/-/typescript-5.9.3.tgz",
      "integrity": "sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==",
      "devOptional": true,
      "license": "Apache-2.0",
      "bin": {
        "tsc": "bin/tsc",
        "tsserver": "bin/tsserver"
      },
      "engines": {
        "node": ">=14.17"
      }
    },
    "node_modules/undici-types": {
      "version": "6.21.0",
      "resolved": "https://registry.npmjs.org/undici-types/-/undici-types-6.21.0.tgz",
      "integrity": "sha512-iwDZqg0QAGrg9Rav5H4n0M64c3mkR59cJ6wQp+7C4nI0gsmExaedaYLNO44eT4AtBBwjbTiGPMlt2Md0T9H9JQ==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/vite": {
      "version": "7.3.1",
      "resolved": "https://registry.npmjs.org/vite/-/vite-7.3.1.tgz",
      "integrity": "sha512-w+N7Hifpc3gRjZ63vYBXA56dvvRlNWRczTdmCBBa+CotUzAPf5b7YMdMR/8CQoeYE5LX3W4wj6RYTgonm1b9DA==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "esbuild": "^0.27.0",
        "fdir": "^6.5.0",
        "picomatch": "^4.0.3",
        "postcss": "^8.5.6",
        "rollup": "^4.43.0",
        "tinyglobby": "^0.2.15"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^20.19.0 || >=22.12.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^20.19.0 || >=22.12.0",
        "jiti": ">=1.21.0",
        "less": "^4.0.0",
        "lightningcss": "^1.21.0",
        "sass": "^1.70.0",
        "sass-embedded": "^1.70.0",
        "stylus": ">=0.54.8",
        "sugarss": "^5.0.0",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "lightningcss": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/vite-node": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/vite-node/-/vite-node-3.2.4.tgz",
      "integrity": "sha512-EbKSKh+bh1E1IFxeO0pg1n4dvoOTt0UDiXMd/qn++r98+jPO1xtJilvXldeuQ8giIB5IkpjCgMleHMNEsGH6pg==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "cac": "^6.7.14",
        "debug": "^4.4.1",
        "es-module-lexer": "^1.7.0",
        "pathe": "^2.0.3",
        "vite": "^5.0.0 || ^6.0.0 || ^7.0.0-0"
      },
      "bin": {
        "vite-node": "vite-node.mjs"
      },
      "engines": {
        "node": "^18.0.0 || ^20.0.0 || >=22.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      }
    },
    "node_modules/vitest": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz",
      "integrity": "sha512-LUCP5ev3GURDysTWiP47wRRUpLKMOfPh+yKTx3kVIEiu5KOMeqzpnYNsKyOoVrULivR8tLcks4+lga33Whn90A==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/chai": "^5.2.2",
        "@vitest/expect": "3.2.4",
        "@vitest/mocker": "3.2.4",
        "@vitest/pretty-format": "^3.2.4",
        "@vitest/runner": "3.2.4",
        "@vitest/snapshot": "3.2.4",
        "@vitest/spy": "3.2.4",
        "@vitest/utils": "3.2.4",
        "chai": "^5.2.0",
        "debug": "^4.4.1",
        "expect-type": "^1.2.1",
        "magic-string": "^0.30.17",
        "pathe": "^2.0.3",
        "picomatch": "^4.0.2",
        "std-env": "^3.9.0",
        "tinybench": "^2.9.0",
        "tinyexec": "^0.3.2",
        "tinyglobby": "^0.2.14",
        "tinypool": "^1.1.1",
        "tinyrainbow": "^2.0.0",
        "vite": "^5.0.0 || ^6.0.0 || ^7.0.0-0",
        "vite-node": "3.2.4",
        "why-is-node-running": "^2.3.0"
      },
      "bin": {
        "vitest": "vitest.mjs"
      },
      "engines": {
        "node": "^18.0.0 || ^20.0.0 || >=22.0.0"
      },
      "funding": {
        "url": "https://opencollective.com/vitest"
      },
      "peerDependencies": {
        "@edge-runtime/vm": "*",
        "@types/debug": "^4.1.12",
        "@types/node": "^18.0.0 || ^20.0.0 || >=22.0.0",
        "@vitest/browser": "3.2.4",
        "@vitest/ui": "3.2.4",
        "happy-dom": "*",
        "jsdom": "*"
      },
      "peerDependenciesMeta": {
        "@edge-runtime/vm": {
          "optional": true
        },
        "@types/debug": {
          "optional": true
        },
        "@types/node": {
          "optional": true
        },
        "@vitest/browser": {
          "optional": true
        },
        "@vitest/ui": {
          "optional": true
        },
        "happy-dom": {
          "optional": true
        },
        "jsdom": {
          "optional": true
        }
      }
    },
    "node_modules/vitest/node_modules/tinyexec": {
      "version": "0.3.2",
      "resolved": "https://registry.npmjs.org/tinyexec/-/tinyexec-0.3.2.tgz",
      "integrity": "sha512-KQQR9yN7R5+OSwaK0XQoj22pwHoTlgYqmUscPYoknOoWCWfj/5/ABTMRi69FrKU5ffPVh5QcFikpWJI/P1ocHA==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/why-is-node-running": {
      "version": "2.3.0",
      "resolved": "https://registry.npmjs.org/why-is-node-running/-/why-is-node-running-2.3.0.tgz",
      "integrity": "sha512-hUrmaWBdVDcxvYqnyh09zunKzROWjbZTiNy8dBEjkS7ehEDQibXJ7XvlmtbwuTclUiIyN+CyXQD4Vmko8fNm8w==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "siginfo": "^2.0.0",
        "stackback": "0.0.2"
      },
      "bin": {
        "why-is-node-running": "cli.js"
      },
      "engines": {
        "node": ">=8"
      }
    },
    "node_modules/xtend": {
      "version": "4.0.2",
      "resolved": "https://registry.npmjs.org/xtend/-/xtend-4.0.2.tgz",
      "integrity": "sha512-LKYU1iAXJXUgAXn9URjiu+MWhyUXHsvfp7mcuYm9dSUKK0/CjtrUwFAxD82/mCWbtLsGjFIad0wIsod4zrTAEQ==",
      "license": "MIT",
      "engines": {
        "node": ">=0.4"
      }
    },
    "node_modules/zod": {
      "version": "3.25.76",
      "resolved": "https://registry.npmjs.org/zod/-/zod-3.25.76.tgz",
      "integrity": "sha512-gzUt/qt81nXsFGKIFcC3YnfEAx5NkunCfnDlvuBSSFS02bcXu4Lmea0AFIUwbLWxWPx3d9p8S5QoaujKcNQxcQ==",
      "license": "MIT",
      "funding": {
        "url": "https://github.com/sponsors/colinhacks"
      }
    }
  }
}
`,
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts", "tests/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
`,
    ".env.example": `NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deeprun
JWT_SECRET=replace-this-with-a-secure-jwt-secret-value
CORS_ALLOWED_ORIGINS=http://localhost:3000
`,
    ".env": `NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/deeprun
JWT_SECRET=replace-this-with-a-secure-jwt-secret-value
CORS_ALLOWED_ORIGINS=http://localhost:3000
`,
    "Dockerfile": `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
COPY tests ./tests
RUN npm run prisma:generate
RUN npm run build
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "run", "start"]
`,
    ".dockerignore": `node_modules
dist
.git
.deeprun
.workspace
.data
.env
`,
    "prisma/schema.prisma": `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String   @map("password_hash")
  role         String   @default("admin")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@map("users")
}
`,
    "prisma/seed.ts": `import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return salt + ":" + hash;
}

async function main(): Promise<void> {
  await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: {
      email: "owner@example.com",
      passwordHash: hashPassword("Password123!"),
      role: "admin"
    }
  });
}

void main()
  .catch((error) => {
    process.stderr.write(String(error) + "\\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
`,
    "prisma/migrations/20250101000000_init/migration.sql": `CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'admin',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
`,
    "src/config/env.ts": `import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/deeprun"),
  JWT_SECRET: z.string().min(32).default("replace-this-with-a-secure-jwt-secret-value"),
  CORS_ALLOWED_ORIGINS: z.string().min(1).default("http://localhost:3000")
});

export const env = envSchema.parse(process.env);

export const allowedCorsOrigins = env.CORS_ALLOWED_ORIGINS.split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);
`,
    "src/config/logger.ts": `import pino from "pino";
import { env } from "./env.js";

const level = env.NODE_ENV === "production" ? "info" : "debug";

export const logger = pino({
  level,
  base: undefined
});
`,
    "src/db/prisma.ts": `import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasources: {
      db: {
        url: env.DATABASE_URL
      }
    }
  });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
`,
    "src/errors/BaseAppError.ts": `export interface ErrorMetadata {
  [key: string]: unknown;
}

export class BaseAppError extends Error {
  name: string;
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;
  readonly metadata?: ErrorMetadata;

  constructor(input: {
    message: string;
    code: string;
    statusCode: number;
    expose?: boolean;
    metadata?: ErrorMetadata;
    cause?: unknown;
  }) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined);
    this.name = "BaseAppError";
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.expose = input.expose ?? true;
    this.metadata = input.metadata;
  }
}
`,
    "src/errors/DomainError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class DomainError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "DOMAIN_ERROR",
      statusCode: 400,
      metadata
    });
    this.name = "DomainError";
  }
}
`,
    "src/errors/ValidationError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class ValidationError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "VALIDATION_ERROR",
      statusCode: 422,
      metadata
    });
    this.name = "ValidationError";
  }
}
`,
    "src/errors/NotFoundError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class NotFoundError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "NOT_FOUND",
      statusCode: 404,
      metadata
    });
    this.name = "NotFoundError";
  }
}
`,
    "src/errors/UnauthorizedError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class UnauthorizedError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "UNAUTHORIZED",
      statusCode: 401,
      metadata
    });
    this.name = "UnauthorizedError";
  }
}
`,
    "src/errors/ConflictError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class ConflictError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "CONFLICT",
      statusCode: 409,
      metadata
    });
    this.name = "ConflictError";
  }
}
`,
    "src/errors/InfrastructureError.ts": `import { BaseAppError, ErrorMetadata } from "./BaseAppError.js";

export class InfrastructureError extends BaseAppError {
  constructor(message: string, metadata?: ErrorMetadata) {
    super({
      message,
      code: "INFRASTRUCTURE_ERROR",
      statusCode: 500,
      expose: false,
      metadata
    });
    this.name = "InfrastructureError";
  }
}
`,
    "src/errors/errorHandler.ts": `import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { BaseAppError } from "./BaseAppError.js";
import { InfrastructureError } from "./InfrastructureError.js";

function normalizeError(error: unknown): BaseAppError {
  if (error instanceof BaseAppError) {
    return error;
  }

  return new InfrastructureError("Internal server error.", {
    reason: error instanceof Error ? error.message : String(error)
  });
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): void {
  const appError = normalizeError(error);

  request.log.error(
    {
      err: error,
      code: appError.code,
      statusCode: appError.statusCode
    },
    "Request failed"
  );

  const payload: Record<string, unknown> = {
    error: appError.code,
    message: appError.expose ? appError.message : "Internal server error"
  };

  if (appError.expose && appError.metadata) {
    payload.metadata = appError.metadata;
  }

  if (env.NODE_ENV !== "production") {
    payload.stack = error.stack;
  }

  reply.status(appError.statusCode).send(payload);
}
`,
    "src/middleware/auth-middleware.ts": `import { FastifyReply, FastifyRequest } from "fastify";
import { UnauthorizedError } from "../errors/UnauthorizedError.js";

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (error) {
    throw new UnauthorizedError("Authentication is required.", {
      reason: error instanceof Error ? error.message : "invalid-token"
    });
  }
}
`,
    "src/modules/auth/entity/auth-entity.ts": `export type AuthRole = "admin" | "member";

export interface AuthEntity {
  id: string;
  email: string;
  passwordHash: string;
  role: AuthRole;
}
`,
    "src/modules/auth/dto/auth-dto.ts": `import { AuthRole } from "../entity/auth-entity.js";

export interface LoginInputDto {
  email: string;
  password: string;
}

export interface LoginOutputDto {
  token: string;
  user: {
    id: string;
    email: string;
    role: AuthRole;
  };
}
`,
    "src/modules/auth/schema/auth-schema.ts": `import { z } from "zod";

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});
`,
    "src/modules/auth/repository/auth-repository.ts": `import { prisma } from "../../../db/prisma.js";
import { InfrastructureError } from "../../../errors/InfrastructureError.js";
import { AuthEntity, AuthRole } from "../entity/auth-entity.js";

function toAuthRole(value: string): AuthRole {
  return value === "admin" ? "admin" : "member";
}

export const authRepository = {
  async findByEmail(email: string): Promise<AuthEntity | null> {
    try {
      const record = await prisma.user.findUnique({
        where: {
          email: email.toLowerCase()
        }
      });

      if (!record) {
        return null;
      }

      return {
        id: record.id,
        email: record.email,
        passwordHash: record.passwordHash,
        role: toAuthRole(record.role)
      };
    } catch (error) {
      throw new InfrastructureError("Failed to query auth repository.", {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
};
`,
    "src/modules/auth/service/auth-service.ts": `import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { env } from "../../../config/env.js";
import { UnauthorizedError } from "../../../errors/UnauthorizedError.js";
import { LoginInputDto } from "../dto/auth-dto.js";
import { AuthEntity } from "../entity/auth-entity.js";
import { authRepository } from "../repository/auth-repository.js";

const jwtSecret = env.JWT_SECRET;

if (!jwtSecret || jwtSecret.length < 32) {
  throw new UnauthorizedError("JWT_SECRET is required and must be at least 32 characters.");
}

function hashWithSalt(password: string, salt: string): Buffer {
  return scryptSync(password, salt, 64);
}

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const digest = hashWithSalt(password, salt).toString("hex");
  return salt + ":" + digest;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(":");
  if (!salt || !expectedHex) {
    return false;
  }

  const actual = hashWithSalt(password, salt);
  const expected = Buffer.from(expectedHex, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

export const authService = {
  async authenticate(input: LoginInputDto): Promise<AuthEntity> {
    const user = await authRepository.findByEmail(input.email);

    if (!user) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    if (!verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedError("Invalid credentials.");
    }

    return user;
  }
};
`,
    "src/modules/auth/controller/auth-controller.ts": `import { FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../../../errors/ValidationError.js";
import { LoginInputDto, LoginOutputDto } from "../dto/auth-dto.js";
import { loginInputSchema } from "../schema/auth-schema.js";
import { authService } from "../service/auth-service.js";

export async function loginController(
  request: FastifyRequest<{ Body: LoginInputDto }>,
  reply: FastifyReply
): Promise<void> {
  const parsed = loginInputSchema.safeParse(request.body);

  if (!parsed.success) {
    throw new ValidationError("Invalid login payload.", parsed.error.flatten());
  }

  const user = await authService.authenticate(parsed.data);
  const token = await request.server.jwt.sign({
    sub: user.id,
    role: user.role
  });

  const response: LoginOutputDto = {
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  };

  reply.status(200).send(response);
}
`,
    "src/modules/auth/tests/auth.service.test.ts": `import { afterEach, describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "../../../errors/UnauthorizedError.js";
import { AuthEntity } from "../entity/auth-entity.js";
import { authRepository } from "../repository/auth-repository.js";
import { authService, hashPassword } from "../service/auth-service.js";

describe("authService.authenticate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the user when credentials are valid", async () => {
    const user: AuthEntity = {
      id: "user-1",
      email: "owner@example.com",
      passwordHash: hashPassword("Password123!", "testsalttestsalt"),
      role: "admin"
    };

    vi.spyOn(authRepository, "findByEmail").mockResolvedValue(user);

    const result = await authService.authenticate({
      email: "owner@example.com",
      password: "Password123!"
    });

    expect(result.id).toBe("user-1");
    expect(result.role).toBe("admin");
  });

  it("throws unauthorized when credentials are invalid", async () => {
    vi.spyOn(authRepository, "findByEmail").mockResolvedValue(null);

    await expect(
      authService.authenticate({
        email: "owner@example.com",
        password: "bad-password"
      })
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
`,
    "src/modules/auth/tests/auth.validation.test.ts": `import { describe, expect, it } from "vitest";
import { loginInputSchema } from "../schema/auth-schema.js";

describe("auth validation", () => {
  it("rejects invalid login payloads", () => {
    const parsed = loginInputSchema.safeParse({
      email: "not-an-email",
      password: "short"
    });

    expect(parsed.success).toBe(false);
  });
});
`,
    "src/app.ts": `import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { allowedCorsOrigins, env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler } from "./errors/errorHandler.js";
import { requireAuth } from "./middleware/auth-middleware.js";
import { loginController } from "./modules/auth/controller/auth-controller.js";

export function buildApp() {
  const app = Fastify({
    loggerInstance: logger
  });

  app.register(helmet);
  app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute"
  });
  app.register(cors, {
    origin: allowedCorsOrigins,
    credentials: true
  });
  app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.setErrorHandler(errorHandler);

  app.get("/health", async () => {
    return {
      ok: true,
      environment: env.NODE_ENV
    };
  });

  app.post("/auth/login", loginController);
  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const payload = await request.jwtVerify<{
      sub: string;
      role: string;
    }>();

    return {
      id: payload.sub,
      role: payload.role
    };
  });

  return app;
}

export const app = buildApp();
`,
    "src/server.ts": `import { app } from "./app.js";
import { env } from "./config/env.js";

async function start(): Promise<void> {
  try {
    await app.listen({
      port: env.PORT,
      host: "0.0.0.0"
    });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    process.exit();
  }
}

void start();
`,
    "tests/integration/health.test.ts": `import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

let app = buildApp();

describe("health endpoint", () => {
  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
  });
});
`
};
const saasStarter = {
    "README.md": `# SaaS Starter\n\nGenerated by deeprun.\n\n## Scripts\n- npm install\n- npm run dev\n\n## Notes\nThis scaffold is intentionally minimal and ready for iterative AI edits.\n`,
    "package.json": `{
  "name": "saas-starter",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.8.2",
    "vite": "^6.2.0",
    "@types/react": "^19.0.8",
    "@types/react-dom": "^19.0.3"
  }
}
`,
    "src/main.tsx": `import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", margin: "2rem" }}>
      <h1>SaaS Starter</h1>
      <p>Start shaping your product with the builder chat.</p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SaaS Starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
};
const agentStarter = {
    "README.md": `# Agent Workflow Starter\n\nA baseline structure for multi-step AI workflows.\n`,
    "src/agent.ts": `export interface AgentTask {
  id: string;
  goal: string;
  steps: string[];
}

export async function runTask(task: AgentTask) {
  const startedAt = new Date().toISOString();
  return {
    task,
    startedAt,
    status: "pending-llm-integration"
  };
}
`,
    "src/index.ts": `import { runTask } from "./agent";

async function main() {
  const result = await runTask({
    id: "demo",
    goal: "Draft user onboarding",
    steps: ["Gather requirements", "Produce implementation plan"]
  });
  console.log(result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`
};
const chatbotStarter = {
    "README.md": `# Chatbot Starter\n\nAn API-first chatbot scaffold that can be extended by the builder.\n`,
    "src/server.ts": `import express from "express";

const app = express();
app.use(express.json());

app.post("/chat", (req, res) => {
  const message = String(req.body?.message ?? "");
  res.json({ reply: "Echo: " + message });
});

app.listen(4001, () => {
  console.log("Chatbot starter listening on http://localhost:4001");
});
`
};
export const templateCatalog = {
    "canonical-backend": {
        id: "canonical-backend",
        type: "backend",
        name: "Canonical Backend",
        description: "Deterministic deeprun backend contract scaffold with strict layers and security baseline.",
        recommendedPrompt: "Build a production backend module with strict layering, typed errors, tests, and no architecture violations.",
        starterFiles: canonicalBackendStarter
    },
    "saas-web-app": {
        id: "saas-web-app",
        type: "web-app",
        name: "SaaS Web App",
        description: "Frontend + API product skeleton for fast feature shipping.",
        recommendedPrompt: "Build a multi-tenant SaaS with auth, billing placeholder, dashboard analytics, and clean component architecture.",
        starterFiles: saasStarter
    },
    "agent-workflow": {
        id: "agent-workflow",
        type: "workflow",
        name: "Agent Workflow",
        description: "Task-oriented orchestration skeleton for autonomous jobs.",
        recommendedPrompt: "Create a workflow engine with queueing, retries, and tool execution logs for each agent step.",
        starterFiles: agentStarter
    },
    chatbot: {
        id: "chatbot",
        type: "web-app",
        name: "Chatbot API",
        description: "A minimal conversational API designed for iterative expansion.",
        recommendedPrompt: "Turn this into a retrieval-augmented chatbot with chat memory, moderation, and observability.",
        starterFiles: chatbotStarter
    }
};
export function listTemplates() {
    return Object.values(templateCatalog);
}
export function getTemplate(templateId) {
    return templateCatalog[templateId];
}
export function getTemplateValidationProfile(templateId) {
    const template = getTemplate(templateId);
    switch (template.type) {
        case "backend":
            return "backend-heavy";
        case "web-app":
            return "web-app-light";
        case "workflow":
            return "workflow-light";
        default: {
            const unreachable = template.type;
            throw new Error(`Unsupported template type for validation profile: ${String(unreachable)}`);
        }
    }
}
