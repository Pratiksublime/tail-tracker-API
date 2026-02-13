import Validator from 'validatorjs';

interface ValidationResult {
    passed: boolean;
    errors: Validator.Errors | null;
}

export function validate(
    data: Record<string, any>,
    rules: Record<string, string>,
): ValidationResult {
    const validation = new Validator(data, rules);

    if (validation.passes()) {
        return { passed: true, errors: null };
    } else {
        return { passed: false, errors: validation.errors };
    }
}
