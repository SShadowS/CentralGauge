enum 70120 "CGR Damage Severity" implements "CGR Damage Severity Rule"
{
    Extensible = true;

    value(0; Minor)
    {
        Implementation = "CGR Damage Severity Rule" = "CGR Minor Damage Rule";
    }
    value(1; Major)
    {
        Implementation = "CGR Damage Severity Rule" = "CGR Major Damage Rule";
    }
}
