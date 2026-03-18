const { withXcodeProject } = require("expo/config-plugins");

const PHASE_NAME = "[EMWDAT] Remove duplicate XCFramework signatures";

const SHELL_SCRIPT = `
if [ -z "\${XCODE_VERSION_MAJOR:-}" ] || [ "\${XCODE_VERSION_MAJOR}" -lt 1500 ]; then
  exit 0
fi

echo "[EMWDAT] Removing duplicated .signature files for Xcode \${XCODE_VERSION_MAJOR}"

remove_signatures() {
  directory="$1"
  if [ -d "$directory" ]; then
    find "$directory" -type f -name "*.signature" -delete || true
  fi
}

remove_signatures "\${BUILD_DIR}/\${CONFIGURATION}-iphoneos"
remove_signatures "\${TARGET_BUILD_DIR}"
`.trim();

function normalizeName(value) {
  if (!value || typeof value !== "string") return "";
  return value.replace(/^"(.*)"$/, "$1");
}

function withRemoveDuplicateXcframeworkSignatures(config) {
  return withXcodeProject(config, (projectConfig) => {
    const project = projectConfig.modResults;
    const targetUuid = project.getFirstTarget().uuid;
    const shellPhases = project.pbxShellScriptBuildPhaseSection();

    const existingEntry = Object.entries(shellPhases).find(([key, phase]) => {
      if (key.endsWith("_comment")) return false;
      return normalizeName(phase?.name) === PHASE_NAME;
    });

    const updatedScript = JSON.stringify(`${SHELL_SCRIPT}\n`);

    if (existingEntry) {
      const [phaseUuid, phase] = existingEntry;
      phase.shellPath = "\"/bin/sh\"";
      phase.shellScript = updatedScript;
      phase.runOnlyForDeploymentPostprocessing = "1";
      phase.showEnvVarsInLog = "0";
      shellPhases[phaseUuid] = phase;
      return projectConfig;
    }

    project.addBuildPhase([], "PBXShellScriptBuildPhase", PHASE_NAME, targetUuid, {
      shellPath: "/bin/sh",
      shellScript: SHELL_SCRIPT,
      runOnlyForDeploymentPostprocessing: 1,
      showEnvVarsInLog: 0,
    });

    return projectConfig;
  });
}

module.exports = withRemoveDuplicateXcframeworkSignatures;
