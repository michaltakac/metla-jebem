const { withXcodeProject } = require("expo/config-plugins");

function isEmbedMWDATPhase(phase) {
  if (!phase || typeof phase !== "object") return false;
  const rawName = String(phase.name ?? phase["name"] ?? "");
  const normalizedName = rawName.replace(/^"|"$/g, "");
  if (normalizedName === "Embed MWDAT Frameworks") return true;

  const script = String(phase.shellScript ?? "");
  return script.includes("MWDATCore.framework") || script.includes("MWDATCamera.framework");
}

module.exports = function withRemoveMWDATEmbed(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const objects = project.hash.project.objects;
    const shellPhases = objects.PBXShellScriptBuildPhase ?? {};

    const phaseIdsToRemove = Object.entries(shellPhases)
      .filter(([key, value]) => !key.endsWith("_comment") && isEmbedMWDATPhase(value))
      .map(([key]) => key);

    if (phaseIdsToRemove.length === 0) {
      return config;
    }

    // Remove references from targets.
    const nativeTargets = objects.PBXNativeTarget ?? {};
    for (const [key, target] of Object.entries(nativeTargets)) {
      if (key.endsWith("_comment") || !target || typeof target !== "object") continue;
      if (!Array.isArray(target.buildPhases)) continue;

      target.buildPhases = target.buildPhases.filter((entry) => {
        if (!entry || typeof entry !== "object") return true;
        const id = entry.value;
        return !phaseIdsToRemove.includes(id);
      });
    }

    // Remove phase objects and their comment entries.
    for (const id of phaseIdsToRemove) {
      delete shellPhases[id];
      delete shellPhases[`${id}_comment`];
    }

    return config;
  });
};
