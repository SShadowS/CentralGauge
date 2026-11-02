table 70020 "CGR Exchange Rate"
{
    DataClassification = CustomerContent;

    // The current exchange rate of a currency. Amount (LCY) = Amount / Currency Factor.
    fields
    {
        field(1; "Currency Code"; Code[10]) { }
        field(2; "Currency Factor"; Decimal) { DecimalPlaces = 0 : 15; }
    }

    keys
    {
        key(PK; "Currency Code") { Clustered = true; }
    }
}
