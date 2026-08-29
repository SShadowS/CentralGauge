enum 71450 "CG X161 Carrier" implements "CG X161 Rate Provider"
{
    Extensible = false;

    value(0; Standard)
    {
        Implementation = "CG X161 Rate Provider" = "CG X161 Standard Carrier";
    }
    value(1; Express)
    {
        Implementation = "CG X161 Rate Provider" = "CG X161 Express Carrier";
    }
}
