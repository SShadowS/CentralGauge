table 70270 "CGR Approval Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { }
        field(2; "Table ID"; Integer) { }
        field(3; "Document No."; Code[20]) { }
        field(4; "Approver ID"; Code[50]) { }
        field(5; Status; Enum "CGR Approval Status") { }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
