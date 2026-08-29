table 71522 "CG X168 Rollup Result"
{
    DataClassification = CustomerContent;
    Caption = 'CG X168 Rollup Result';

    fields
    {
        field(1; "Group Code"; Code[20])
        {
            Caption = 'Group Code';
            DataClassification = CustomerContent;
        }
        field(2; "Own Amount"; Decimal)
        {
            Caption = 'Own Amount';
            DataClassification = CustomerContent;
        }
        field(3; "Total Amount"; Decimal)
        {
            Caption = 'Total Amount';
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "Group Code")
        {
            Clustered = true;
        }
    }
}
