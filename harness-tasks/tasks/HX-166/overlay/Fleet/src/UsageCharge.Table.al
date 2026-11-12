table 70183 "CGR Usage Charge"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { }
        field(2; "Period Start"; Date) { }
        field(3; "Km Driven"; Integer) { }
        field(4; "Km Over"; Integer) { }
        field(5; "Band Code"; Code[10]) { }
        field(6; Fee; Decimal) { }
    }

    keys
    {
        key(PK; "Vehicle No.", "Period Start") { Clustered = true; }
    }
}
