namespace CG.Finance.Dimension;

using Microsoft.Finance.Dimension;

query 70017 "CG Dimension Matrix"
{
    QueryType = Normal;
    Caption = 'CG Dimension Matrix';

    elements
    {
        dataitem(DepartmentDimensionValue; "Dimension Value")
        {
            DataItemTableFilter = "Dimension Code" = const('DEPARTMENT');

            column(DepartmentCode; "Code")
            {
            }
            column(DepartmentName; Name)
            {
            }

            dataitem(ProjectDimensionValue; "Dimension Value")
            {
                SqlJoinType = CrossJoin;
                DataItemTableFilter = "Dimension Code" = const('PROJECT');

                column(ProjectCode; "Code")
                {
                }
                column(ProjectName; Name)
                {
                }

                dataitem(DimensionSetEntry; "Dimension Set Entry")
                {
                    DataItemLink = "Dimension Value Code" = ProjectDimensionValue."Code";
                    SqlJoinType = LeftOuterJoin;

                    column(MatchCount)
                    {
                        Method = Count;
                    }
                }
            }
        }
    }
}