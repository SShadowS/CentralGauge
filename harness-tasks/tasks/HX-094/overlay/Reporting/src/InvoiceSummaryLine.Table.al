table 70531 "CGR Invoice Summary Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Line No."; Integer) { }
        field(2; "Line Type"; Enum "CGR Summary Line Type") { }
        field(3; "Reason Code"; Code[10]) { }
        field(4; "Tax Group Code"; Code[10]) { }
        field(5; "Base Amount"; Decimal) { }
        field(6; Amount; Decimal) { }
    }

    keys
    {
        key(PK; "Line No.") { Clustered = true; }
    }
}
