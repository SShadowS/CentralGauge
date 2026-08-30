table 70370 "CG X072 Loyalty Candidate"
{
    DataClassification = CustomerContent;
    Caption = 'Loyalty Program Candidate';

    fields
    {
        field(1; "No."; Code[20])
        {
            Caption = 'No.';
            DataClassification = CustomerContent;
        }
        field(2; "Customer Name"; Text[100])
        {
            Caption = 'Customer Name';
            DataClassification = CustomerContent;
        }
        field(3; "Lifetime Spend"; Decimal)
        {
            Caption = 'Lifetime Spend';
            DataClassification = CustomerContent;
            DecimalPlaces = 2 : 2;
            MinValue = 0;
        }
        field(4; "Manual VIP Override"; Boolean)
        {
            Caption = 'Manual VIP Override';
            DataClassification = CustomerContent;
        }
        field(5; "Priority Support Approved"; Boolean)
        {
            Caption = 'Priority Support Approved';
            DataClassification = CustomerContent;
            Editable = false;
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
