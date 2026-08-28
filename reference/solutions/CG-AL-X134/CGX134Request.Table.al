table 70941 "CG X134 Request"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; Description; Text[100])
        {
            DataClassification = CustomerContent;
        }
        field(3; "Paid Amount"; Decimal)
        {
            Caption = 'Paid Amount';
            FieldClass = FlowField;
            CalcFormula = sum("CG X134 Payment".Amount where("Request No." = field("No.")));
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
