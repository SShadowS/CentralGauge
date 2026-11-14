table 70396 "CGR Lease Activity Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { AutoIncrement = true; }
        field(2; "Contract No."; Code[20]) { }
        field(3; Activity; Text[30]) { }
        field(4; "Reference No."; Integer) { }
        field(5; Amount; Decimal) { }
        field(6; Sent; Boolean) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(Contract; "Contract No.", "Reference No.") { }
    }
}
