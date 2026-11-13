table 70252 "CGR Desk Rate"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; "Day Rate"; Decimal) { }
        field(4; "Season Surcharge %"; Decimal) { }
        field(5; "Minimum Quote"; Decimal) { }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
