table 70360 "CG X071 Customer"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(10; "Max Order Amount (LCY)"; Decimal)
        {
            Caption = 'Max Order Amount (LCY)';
            DataClassification = CustomerContent;
            MinValue = 0;
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
