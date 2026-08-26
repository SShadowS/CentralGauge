table 70851 "CG X125 Refund Request"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(2; "Customer No."; Code[20]) { DataClassification = CustomerContent; }
        field(3; Amount; Integer) { DataClassification = CustomerContent; }
        field(4; Status; Option)
        {
            OptionMembers = Open,Released;
            DataClassification = CustomerContent;
        }
        field(5; "Manual Overrides"; Integer) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Entry No.") { Clustered = true; }
    }
}
