table 70942 "CG X134 History Entry"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            AutoIncrement = true;
            DataClassification = CustomerContent;
        }
        field(2; Approver; Code[50])
        {
            DataClassification = CustomerContent;
        }
        field(3; "Request No."; Code[20])
        {
            DataClassification = CustomerContent;
            TableRelation = "CG X134 Request"."No.";
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }
}
