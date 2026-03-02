import type { ProjectTemplateType } from "../../types.js";
import type { TemplateValidationProfile } from "../../templates/catalog.js";
import { runHeavyProjectValidation, type HeavyValidationResult } from "./heavy-validator.js";
import { runWebAppLightValidation } from "./web-app-light-validator.js";
import { runWorkflowLightValidation } from "./workflow-light-validator.js";
export type { HeavyValidationResult } from "./heavy-validator.js";

export interface ValidationProfileDispatchInput {
  profile: TemplateValidationProfile;
  templateType: ProjectTemplateType;
  projectRoot: string;
  ref?: string | null;
}

export async function dispatchValidationForProfile(
  input: ValidationProfileDispatchInput
): Promise<HeavyValidationResult> {
  switch (input.profile) {
    case "backend-heavy":
      return runHeavyProjectValidation({
        projectRoot: input.projectRoot,
        ref: input.ref
      });
    case "web-app-light":
      if (input.templateType !== "web-app") {
        throw new Error("Template validation profile mismatch: web-app-light requires template type 'web-app'.");
      }
      return runWebAppLightValidation();
    case "workflow-light":
      if (input.templateType !== "workflow") {
        throw new Error("Template validation profile mismatch: workflow-light requires template type 'workflow'.");
      }
      return runWorkflowLightValidation();
    default: {
      const unreachable: never = input.profile;
      throw new Error(`Unsupported validation profile: ${String(unreachable)}`);
    }
  }
}
