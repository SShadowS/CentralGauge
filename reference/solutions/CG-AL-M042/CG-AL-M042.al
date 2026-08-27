table 70150 "CG M042 Object Range"
{
    Caption = 'CG M042 Object Range';
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[20])
        {
            Caption = 'Code';
            NotBlank = true;
        }
        field(10; "Range Min"; Integer)
        {
            Caption = 'Range Min';

            trigger OnValidate()
            var
                PreviousWidth: Integer;
            begin
                PreviousWidth := xRec."Range Max" - xRec."Range Min";
                "Range Max" := "Range Min" + PreviousWidth;
            end;
        }
        field(20; "Range Max"; Integer)
        {
            Caption = 'Range Max';
        }
    }

    keys
    {
        key(PK; "Code")
        {
            Clustered = true;
        }
    }

    procedure GetRangeWidth(): Integer
    begin
        exit("Range Max" - "Range Min");
    end;
}