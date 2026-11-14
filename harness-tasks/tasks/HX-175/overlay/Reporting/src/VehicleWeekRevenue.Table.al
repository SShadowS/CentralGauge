table 70576 "CGR Vehicle Week Revenue"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Vehicle No."; Code[20]) { TableRelation = "CGR Vehicle"; }
        field(2; Year; Integer) { }
        field(3; "Week No."; Integer) { }
        field(4; "Week Start"; Date) { }
        field(5; Amount; Decimal) { }
        field(6; "Entry Count"; Integer) { }
    }

    keys
    {
        key(PK; "Vehicle No.", Year, "Week No.") { Clustered = true; }
    }
}
