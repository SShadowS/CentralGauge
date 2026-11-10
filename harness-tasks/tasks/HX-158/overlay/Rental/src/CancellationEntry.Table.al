table 70280 "CGR Cancellation Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; "Branch Code"; Code[10]) { }
        field(4; "Fee Amount"; Decimal) { }
        field(5; Waived; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
