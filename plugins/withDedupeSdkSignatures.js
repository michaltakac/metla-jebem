const { withXcodeProject } = require("expo/config-plugins");

module.exports = function withDedupeSdkSignatures(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targetUuid = project.getFirstTarget().uuid;

    // Avoid adding duplicate phase entries across regenerations.
    const phases = project.hash.project.objects.PBXShellScriptBuildPhase ?? {};
    for (const [key, value] of Object.entries(phases)) {
      if (key.endsWith("_comment")) continue;
      const name = String(value?.name ?? "").replace(/^"|"$/g, "");
      if (name === "Deduplicate SDK Signatures") {
        return config;
      }
    }

    const shellScript = `
set -euo pipefail

FRAMEWORKS_DIR="\${TARGET_BUILD_DIR}/\${FRAMEWORKS_FOLDER_PATH}"
if [ ! -d "\${FRAMEWORKS_DIR}" ]; then
  exit 0
fi

TMP_DIR="\${TARGET_TEMP_DIR}/signature-dedupe"
mkdir -p "\${TMP_DIR}"
find "\${TMP_DIR}" -type f -delete

find "\${FRAMEWORKS_DIR}" -type f -name "*.signature" | while IFS= read -r sig; do
  base="$(basename "\${sig}")"
  marker="\${TMP_DIR}/\${base}"
  if [ -f "\${marker}" ]; then
    echo "Removing duplicate SDK signature: \${sig}"
    rm -f "\${sig}"
  else
    touch "\${marker}"
  fi
done
`.trim();

    project.addBuildPhase([], "PBXShellScriptBuildPhase", "Deduplicate SDK Signatures", targetUuid, {
      shellPath: "/bin/sh",
      shellScript,
    });

    return config;
  });
};
