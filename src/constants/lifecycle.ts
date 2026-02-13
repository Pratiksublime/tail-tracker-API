import { LifecyclePhase, LifecycleState, UserRole } from "@prisma/client";

/**
 * Defines valid next steps for a dog based on its current state.
 * This prevents jumping from 'IN_TRANSIT' to 'RELEASED' directly.
 */
export const STATE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
    [LifecycleState.IN_TRANSIT]: [LifecycleState.AWAITING_IDENTIFICATION],
    [LifecycleState.AWAITING_IDENTIFICATION]: [LifecycleState.UNDER_OBSERVATION, LifecycleState.EMERGENCY_MEDICAL],
    [LifecycleState.UNDER_OBSERVATION]: [LifecycleState.ELIGIBLE_FOR_KENNEL, LifecycleState.UNDER_MEDICAL_TREATMENT],
    [LifecycleState.EMERGENCY_MEDICAL]: [LifecycleState.UNDER_MEDICAL_TREATMENT],
    [LifecycleState.UNDER_MEDICAL_TREATMENT]: [LifecycleState.POST_SURGERY_RECOVERY, LifecycleState.MEDICAL_HOLD, LifecycleState.ELIGIBLE_FOR_KENNEL],
    [LifecycleState.POST_SURGERY_RECOVERY]: [LifecycleState.ELIGIBLE_FOR_KENNEL],
    [LifecycleState.MEDICAL_HOLD]: [LifecycleState.ELIGIBLE_FOR_KENNEL],
    [LifecycleState.ELIGIBLE_FOR_KENNEL]: [LifecycleState.IN_KENNEL],
    [LifecycleState.IN_KENNEL]: [LifecycleState.TEMPORARILY_ISOLATED, LifecycleState.READY_FOR_RELEASE],
    [LifecycleState.TEMPORARILY_ISOLATED]: [LifecycleState.IN_KENNEL],
    [LifecycleState.READY_FOR_RELEASE]: [LifecycleState.RELEASED, LifecycleState.TRANSFERRED],
    // 'DECEASED', 'RELEASED', and 'TRANSFERRED' are terminal states usually
    [LifecycleState.RELEASED]: [],
    [LifecycleState.TRANSFERRED]: [],
    [LifecycleState.DECEASED]: [],
};

// Special Case: According to your table, 'DECEASED' can be reached from 'ANY'
export const GLOBAL_TRANSITIONS: LifecycleState[] = [LifecycleState.DECEASED];

/**
 * Defines which roles are authorized to move a dog INTO a specific state.
 */
export const ROLE_PERMISSIONS: Record<LifecycleState, UserRole[]> = {
    [LifecycleState.IN_TRANSIT]: [UserRole.FIELD_TECH, UserRole.SUPER_ADMIN], // Initial state
    [LifecycleState.AWAITING_IDENTIFICATION]: [UserRole.SHELTER_STAFF, UserRole.SHELTER_MANAGER],
    [LifecycleState.UNDER_OBSERVATION]: [UserRole.SHELTER_STAFF, UserRole.SHELTER_MANAGER],
    [LifecycleState.EMERGENCY_MEDICAL]: [UserRole.SHELTER_STAFF, UserRole.SHELTER_MANAGER, UserRole.DOCTOR],
    [LifecycleState.ELIGIBLE_FOR_KENNEL]: [UserRole.SHELTER_MANAGER, UserRole.DOCTOR],
    [LifecycleState.UNDER_MEDICAL_TREATMENT]: [UserRole.DOCTOR],
    [LifecycleState.POST_SURGERY_RECOVERY]: [UserRole.DOCTOR],
    [LifecycleState.MEDICAL_HOLD]: [UserRole.DOCTOR],
    [LifecycleState.IN_KENNEL]: [UserRole.SHELTER_STAFF, UserRole.SHELTER_MANAGER],
    [LifecycleState.TEMPORARILY_ISOLATED]: [UserRole.SHELTER_MANAGER, UserRole.DOCTOR],
    [LifecycleState.READY_FOR_RELEASE]: [UserRole.SHELTER_MANAGER],
    [LifecycleState.RELEASED]: [UserRole.SHELTER_MANAGER],
    [LifecycleState.TRANSFERRED]: [UserRole.SHELTER_MANAGER],
    [LifecycleState.DECEASED]: [UserRole.SHELTER_MANAGER, UserRole.DOCTOR],
};

/**
 * Maps every state to its broad H4 Lifecycle Phase.
 */
export const STATE_TO_PHASE: Record<LifecycleState, LifecyclePhase> = {
    // Phase A
    [LifecycleState.IN_TRANSIT]: LifecyclePhase.INTAKE_IDENTIFICATION,
    [LifecycleState.AWAITING_IDENTIFICATION]: LifecyclePhase.INTAKE_IDENTIFICATION,
    [LifecycleState.UNDER_OBSERVATION]: LifecyclePhase.INTAKE_IDENTIFICATION,
    [LifecycleState.EMERGENCY_MEDICAL]: LifecyclePhase.INTAKE_IDENTIFICATION,

    // Phase B
    [LifecycleState.UNDER_MEDICAL_TREATMENT]: LifecyclePhase.MEDICAL_INTERVENTION,
    [LifecycleState.POST_SURGERY_RECOVERY]: LifecyclePhase.MEDICAL_INTERVENTION,
    [LifecycleState.MEDICAL_HOLD]: LifecyclePhase.MEDICAL_INTERVENTION,

    // Phase C
    [LifecycleState.ELIGIBLE_FOR_KENNEL]: LifecyclePhase.SHELTER_MANAGEMENT,
    [LifecycleState.IN_KENNEL]: LifecyclePhase.SHELTER_MANAGEMENT,
    [LifecycleState.TEMPORARILY_ISOLATED]: LifecyclePhase.SHELTER_MANAGEMENT,

    // Phase D
    [LifecycleState.READY_FOR_RELEASE]: LifecyclePhase.FINAL_DISPOSITION,
    [LifecycleState.RELEASED]: LifecyclePhase.FINAL_DISPOSITION,
    [LifecycleState.TRANSFERRED]: LifecyclePhase.FINAL_DISPOSITION,
    [LifecycleState.DECEASED]: LifecyclePhase.FINAL_DISPOSITION,
};