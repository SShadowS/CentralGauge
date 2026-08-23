table 70580 "CG X093 Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Customer No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(3; "Order Date"; Date)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
