table 70011 "CGR Branch Rounding"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Branch Code"; Code[10]) { }
        field(2; Description; Text[100]) { }
        field(3; "Rounding Precision"; Decimal) { DecimalPlaces = 0 : 5; MinValue = 0; }
    }

    keys
    {
        key(PK; "Branch Code") { Clustered = true; }
    }
}
