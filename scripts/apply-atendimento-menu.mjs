import fs from "node:fs";

function patchFile(path, transform) {
  if (!fs.existsSync(path)) {
    console.log(`Ignorado: ${path} não existe.`);
    return;
  }

  const current = fs.readFileSync(path, "utf8");
  const next = transform(current);

  if (next === current) {
    console.log(`Sem alteração: ${path}`);
    return;
  }

  fs.writeFileSync(`${path}.bak-atendimento`, current);
  fs.writeFileSync(path, next);
  console.log(`Atualizado: ${path}`);
}

patchFile("src/components/platform-shell.tsx", (source) => {
  if (source.includes('href: "/atendimento"')) return source;

  const pattern = /(\{\s*label:\s*"Operações",[\s\S]*?section:\s*"OPERAÇÃO",\s*\},)/m;
  const match = source.match(pattern);

  if (!match) {
    throw new Error(
      "Não encontrei o bloco de Operações no platform-shell.tsx. Veja o README.",
    );
  }

  return source.replace(
    match[1],
    `${match[1]}
  {
    label: "Atendimento",
    href: "/atendimento",
    moduleCode: "SERVICE_CENTER",
    icon: icons.support,
    section: "ATENDIMENTO",
  },`,
  );
});

patchFile(
  "src/components/permissions/permissions-manager.tsx",
  (source) => {
    if (source.includes('"SERVICE_CENTER"')) return source;

    const patterns = [
      '["OPERATIONS", "Operações"],',
      '["OPERATIONS","Operações"],',
    ];
    const marker = patterns.find((item) => source.includes(item));

    if (!marker) {
      throw new Error(
        "Não encontrei OPERATIONS no permissions-manager.tsx. Veja o README.",
      );
    }

    return source.replace(
      marker,
      `${marker}
  ["SERVICE_CENTER", "Atendimento"],`,
    );
  },
);

console.log("Patch concluído.");
