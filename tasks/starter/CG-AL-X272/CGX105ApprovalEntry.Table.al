table 70650 "CG X105 Approval Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Approver ID"; Code[20]) { DataClassification = CustomerContent; }
        field(3; Status; Enum "CG X105 Approval Status") { DataClassification = CustomerContent; }
        field(4; "Amount Limit"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ApproverKey; "Approver ID", Status) { }
    }
}
