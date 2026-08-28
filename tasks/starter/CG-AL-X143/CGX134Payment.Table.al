table 70940 "CG X134 Payment"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            AutoIncrement = true;
            DataClassification = CustomerContent;
        }
        field(2; "Request No."; Code[20])
        {
            DataClassification = CustomerContent;
            TableRelation = "CG X134 Request"."No.";
        }
        field(3; Amount; Decimal)
        {
            DataClassification = CustomerContent;
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
