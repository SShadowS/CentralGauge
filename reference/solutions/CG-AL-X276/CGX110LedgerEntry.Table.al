table 70701 "CG X110 Ledger Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Account No."; Code[20]) { }
        field(3; "Posting Date"; Date) { }
        field(4; Description; Text[50]) { }
        field(5; Amount; Decimal) { }
        field(6; "Batch Name"; Code[10]) { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
