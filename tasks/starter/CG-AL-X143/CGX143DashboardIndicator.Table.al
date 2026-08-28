table 71070 "CG X143 Dashboard Indicator"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Assignment No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; "Has Pending Job"; Boolean)
        {
            DataClassification = CustomerContent;
        }
        field(3; "Latest Activity Amount"; Decimal)
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Assignment No.")
        {
            Clustered = true;
        }
    }
}
