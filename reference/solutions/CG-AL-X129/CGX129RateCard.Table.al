table 70890 "CG X129 Rate Card"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Tier Code"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Hourly Rate"; Decimal) { DataClassification = CustomerContent; }
        field(3; "Minimum Hours"; Decimal) { DataClassification = CustomerContent; }
        field(4; "Flat Fee"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Tier Code") { Clustered = true; }
    }
}
