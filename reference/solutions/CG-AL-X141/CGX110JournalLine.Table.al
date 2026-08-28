table 70700 "CG X110 Journal Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Batch Name"; Code[10]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Account No."; Code[20]) { }
        field(4; "Posting Date"; Date) { }
        field(5; Description; Text[50]) { }
        field(6; Amount; Decimal) { }
        field(7; Status; Enum "CG X110 Journal Status") { }
    }

    keys
    {
        key(PK; "Batch Name", "Line No.") { Clustered = true; }
    }
}
