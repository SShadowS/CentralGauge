enum 70201 "CGR Pricing Method" implements "CGR Rental Price Method"
{
    Extensible = true;

    value(0; Daily)
    {
        Implementation = "CGR Rental Price Method" = "CGR Daily Price";
    }
    value(1; "Weekend Package")
    {
        Implementation = "CGR Rental Price Method" = "CGR Weekend Package Price";
    }
}
