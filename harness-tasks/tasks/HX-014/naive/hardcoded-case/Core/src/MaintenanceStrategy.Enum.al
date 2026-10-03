enum 70000 "CGR Maintenance Strategy" implements "CGR Maintenance Strategy", "CGR Service Interval"
{
    Extensible = true;
    DefaultImplementation = "CGR Service Interval" = "CGR Default Maintenance";

    value(0; Default)
    {
        Implementation = "CGR Maintenance Strategy" = "CGR Default Maintenance",
                         "CGR Service Interval" = "CGR Default Maintenance";
    }
}
