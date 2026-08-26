table 70820 "CG X122 Document"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Amount; Decimal) { DataClassification = CustomerContent; }
        field(3; Status; Option)
        {
            OptionMembers = Open,Released,Cancelled;
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
