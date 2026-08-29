table 71481 "CG X164 Usage Trace"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; AutoIncrement = true; }
        field(2; "Request No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Description; Text[100]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
        key(ReqNo; "Request No.") { }
    }
}
