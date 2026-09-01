table 70500 "CG X085 Batch Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Description; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Template Code"; Code[20]) { DataClassification = CustomerContent; }
        field(4; "Created Date"; Date) { DataClassification = CustomerContent; }
        field(5; Status; Option)
        {
            OptionMembers = Open,Closed;
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
