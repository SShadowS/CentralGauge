table 70110 "CGR Service Plan"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; Strategy; Enum "CGR Maintenance Strategy") { }
        field(4; "Interval Months"; Integer) { MinValue = 0; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
